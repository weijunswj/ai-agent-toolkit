#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const docContractSync = require('./sync-repo-doc-contract.cjs');
const agentInstructionSync = require('./sync-agent-instruction-shims.cjs');
const sourceLockAudit = require('./audit-project-source-locks.cjs');
const skillPortabilityAudit = require('./audit-skill-portability.cjs');
const projectSync = require('./sync-toolkit-projects.cjs');

function workspaceRootFromArgs(args = process.argv.slice(2)) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--workspace') return args[i + 1] || '';
    if (arg.startsWith('--workspace=')) return arg.slice('--workspace='.length);
  }
  return '';
}

const workspaceRoot = workspaceRootFromArgs();
const root = path.resolve(workspaceRoot || process.env.TOOLKIT_WORKSPACE_ROOT || process.cwd());
const registryYamlText = 'reg' + 'istry/*.' + 'yaml';
const packYamlText = 'pack.' + 'yaml';
const removedForAiPathPattern = new RegExp('(^|[^A-Za-z0-9_])' + 'for_' + 'ai\\/');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const expectedFiles = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.agents/rules/00-agent-toolkit-bootstrap.md',
  'package.json',
  '.gitignore',
  '.gitattributes',
  'repo/docs/HOW-TO-USE.md',
  'repo/docs/SKILL-PORTABILITY-AND-FIDELITY.md',
  '_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/source-of-truth-contract.md',
  'repo/docs/FOR_AI_AGENTS.md',
  'repo/docs/SAFE-UPDATES.md',
  'repo/docs/SOURCE-OF-TRUTH.md',
  'repo/docs/RETIRED-SOURCE-PROVENANCE.md',
  'repo/docs/CLEANUP-POLICY.md',
  'repo/docs/THIRD-PARTY-SOURCE-NOTES.md',
  'repo/docs/PROJECT-MODULE-STANDARD.md',
  'repo/docs/WRITE-SAFETY-MODEL.md',
  'repo/docs/PROJECT-REHAUL-CHECKLIST.md',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/README.md',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/scripts/core.py',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/scripts/design_system.py',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/app-interface.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/charts.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/products.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/styles.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/colors.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/google-fonts.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/icons.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/landing.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/react-performance.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/typography.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/ui-reasoning.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/ux-guidelines.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/react.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/nextjs.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/vue.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/svelte.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/astro.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/swiftui.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/react-native.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/flutter.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/nuxtjs.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/nuxt-ui.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/html-tailwind.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/shadcn.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/jetpack-compose.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/threejs.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/angular.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/laravel.csv',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/tests/test_local_only.py',
  'mcp/registry/skills.registry.json',
  'mcp/registry/playbooks.registry.json',
  'mcp/registry/templates.registry.json',
  'mcp/registry/packs.registry.json',
  'mcp/registry/projects.registry.json',
  'mcp/registry/tools.registry.json',
  'mcp/registry/source-repos.registry.json',
  'mcp/registry/consumers.registry.json',
  '_projects/n8n/local-setup/SOURCE-LOCK.json',
  '_projects/development/ai-coding-agent-rules/SOURCE-LOCK.json',
  '_projects/n8n/workflow-toolkit/SOURCE-LOCK.json',
  '_projects/cicd/secure-installer/SOURCE-LOCK.json',
  '_projects/design/ui-ux-pro-max/SOURCE-LOCK.json',
  'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
  'skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md',
  'skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md',
  'skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md',
  'skills/n8n-agent-rules/SKILL.md',
  'skills/n8n-agent-rules/README.md',
  'skills/n8n-agent-rules/n8n-agent-rules.md',
  'skills/n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md',
  'skills/n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md',
  'skills/n8n-agent-rules/adapters/GEMINI.n8n-brief.template.md',
  'skills/n8n-agent-rules/scripts/install-n8n-agent-adapter.cjs',
  'skills/n8n-local-setup/references/n8n-agent-rules.md',
  'skills/n8n-workflow-helper-scripts/references/n8n-agent-rules.md',
  'skills/n8n-workflow-templates/references/n8n-agent-rules.md',
  '_projects/development/ai-coding-agent-rules/_main/CLAUDE.template.md',
  '_projects/development/ai-coding-agent-rules/_main/GEMINI.template.md',
  '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
  '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md',
  '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md',
  '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md',
  'repo/scripts/sync-agent-instruction-shims.cjs',
  'repo/scripts/validate-toolkit.cjs',
  'repo/scripts/sync-toolkit-projects.cjs',
  'repo/scripts/audit-project-source-locks.cjs',
  'repo/scripts/audit-published-surfaces.cjs',
  'repo/scripts/watch-project-sources.cjs',
  'repo/scripts/check-project-source-updates.cjs',
  'repo/scripts/package-skills.cjs',
  'repo/scripts/package-packs.cjs',
  'repo/scripts/audit-skill-portability.cjs',
  'repo/scripts/run-design-tests.cjs',
  'repo/scripts/safe-source-update.cjs',
  'repo/scripts/sync-repo-doc-contract.cjs',
  'repo/docs/published-surface-audit-baseline.json',
  '.github/workflows/auto-sync-generated-surfaces.yml',
  '.github/workflows/source-watch-plan.yml',
  '.github/workflows/source-watch-pr.yml',
  '.github/workflows/validate.yml'
];

const expectedDirs = [
  '_projects',
  '_projects/n8n/local-setup',
  '_projects/n8n/local-setup/_main',
  '_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials',
  '_projects/development/ai-coding-agent-rules',
  '_projects/development/ai-coding-agent-rules/_main',
  '_projects/development/ai-coding-agent-rules/_main/_partials',
  '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local',
  'skills/ai-coding-agent-rules/repo-local',
  '_projects/n8n/workflow-toolkit',
  '_projects/n8n/workflow-toolkit/_main',
  '_projects/cicd/secure-installer',
  '_projects/cicd/secure-installer/_main',
  '_projects/design/ui-ux-pro-max',
  '_projects/design/ui-ux-pro-max/_main',
  'skills/ui-ux-secure-frontend-design',
  'skills/ai-coding-agent-rules',
  'skills/n8n-agent-rules',
  'skills/n8n-agent-rules/adapters',
  'skills/n8n-agent-rules/scripts',
  'skills/windows-localhost-workflows',
  'skills/n8n-workflow-helper-scripts',
  'skills/n8n-workflow-templates',
  'skills/n8n-local-setup',
  'skills/secure-cicd-installer',
  'skills/knowledge-index-updater',
  'skills/n8n-local-setup/references/ai-agent-platforms',
  'skills/n8n-workflow-helper-scripts/references',
  'skills/n8n-workflow-templates/references',
  'mcp/references',
  'skills/n8n-local-setup/references/n8n',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer',
  'skills/n8n-workflow-templates/templates/error-handling',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/scripts',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/tests',
  'skills/ui-ux-secure-frontend-design/packs/frontend-design-skill',
  'skills/ui-ux-secure-frontend-design/packs/design-system-generator',
  'skills/n8n-local-setup/packs/codex-n8n-local',
  'skills/n8n-local-setup/packs/claude-code-n8n-local',
  'skills/secure-cicd-installer/packs/secure-cicd',
  'mcp/registry-mcp',
  'mcp/installer-mcp',
  'mcp/projects',
  'mcp/registry',
  '.agents',
  '.agents/rules',
  '.github/workflows'
];

const registryFiles = [
  'mcp/registry/skills.registry.json',
  'mcp/registry/playbooks.registry.json',
  'mcp/registry/templates.registry.json',
  'mcp/registry/packs.registry.json',
  'mcp/registry/projects.registry.json',
  'mcp/registry/tools.registry.json',
  'mcp/registry/source-repos.registry.json',
  'mcp/registry/consumers.registry.json'
];

const activeThirdPartySources = new Map([
  ['nextlevelbuilder/ui-ux-pro-max-skill', {
    risk: 'third-party',
    review_policy: 'manual_review_required',
    requiredStatus: /attribution required/i,
    requiredRole: /MIT|third-party|external/i
  }]
]);

const allowedRootEntries = new Set([
  '.git',
  '.github',
  '.gitattributes',
  '.gitignore',
  '.agents',
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'README.md',
  '_projects',
  'mcp',
  'package.json',
  'repo',
  'skills'
]);

const ignoredLocalDirs = new Set([
  '.n8n-local',
  '.tmp',
  'n8n-workflows',
  '.to-sanitise',
  '.sanitised',
  '.n8n-workflow-backups'
]);

const staleReferenceRoots = [
  'README.md',
  'AGENTS.md',
  'package.json',
  '.github',
  'repo'
];

const staleRootSurfacePatterns = [
  { label: 'root templates surface', regex: /(^|\n)\s*\|\s+`?templates\/?`?\s+\|/i },
  { label: 'root packs surface', regex: /(^|\n)\s*\|\s+`?packs\/?`?\s+\|/i },
  { label: 'root registry surface', regex: /(^|\n)\s*\|\s+`?registry\/?`?\s+\|/i },
  { label: 'root tools surface', regex: /(^|\n)\s*\|\s+`?tools\/?`?\s+\|/i },
  { label: 'root guides surface', regex: /(^|\n)\s*\|\s+`?guides\/?`?\s+\|/i }
];

const staleProjectExportsPath = /\bprojects\/[^ \n`"')]+\/exports\//;

const allowedExecutablePrefixes = [
  'repo/scripts/',
  'repo/tests/',
  '.github/workflows/',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/scripts/',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/tests/',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/',
  'skills/n8n-agent-rules/scripts/',
  'skills/n8n-local-setup/templates/local-stack/'
];

const executableExtensions = new Set([
  '.ps1', '.cmd', '.bat', '.cjs', '.mjs', '.js', '.ts', '.tsx', '.py', '.sh', '.exe', '.dll'
]);

const designGeneratorForbiddenTokens = [
  'requests',
  'urllib',
  'httpx',
  'aiohttp',
  'socket',
  'subprocess',
  'os.system',
  'webbrowser',
  'curl',
  'wget',
  'npm install',
  'pip install'
];

const secretPatterns = [
  { label: 'OpenAI-style API key', regex: /sk-[A-Za-z0-9_-]{20,}/ },
  { label: 'Google API key', regex: /AIza[0-9A-Za-z_-]{20,}/ },
  { label: 'Pinecone-looking API key', regex: /pcsk_[A-Za-z0-9_-]{20,}/i },
  { label: 'Bearer token literal', regex: /Bearer\s+[A-Za-z0-9._-]{20,}/i },
  { label: 'JWT-looking token', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { label: 'private key marker', regex: /BEGIN [A-Z ]*PRIVATE KEY/ }
];

function slash(value) {
  return value.split(path.sep).join('/');
}

function resolveRel(relPath) {
  return path.join(root, relPath);
}

function existsRel(relPath) {
  return fs.existsSync(resolveRel(relPath));
}

function readText(relPath) {
  return fs.readFileSync(resolveRel(relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

function retiredInternalSourceReposFromLocks() {
  const repos = new Set(sourceLockAudit.knownRetiredInternalSourceRepos || []);
  for (const lockPath of sourceLockAudit.discoverLockFiles()) {
    let lock;
    try {
      lock = readJson(lockPath);
    } catch {
      // validateSourceLocks reports malformed lock files with normal FAIL diagnostics.
      continue;
    }
    if (
      lock.source_lifecycle === 'retired_after_migration' &&
      lock.source_role === 'migration_provenance_only' &&
      typeof lock.source_repo === 'string'
    ) {
      repos.add(lock.source_repo);
    }
  }
  return repos;
}

function isIgnoredWalkDir(name) {
  return name === '.git' || name === '__pycache__' || ignoredLocalDirs.has(name);
}

function walk(dir = root, entries = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory() && isIgnoredWalkDir(item.name)) continue;
    const fullPath = path.join(dir, item.name);
    const relPath = slash(path.relative(root, fullPath));
    entries.push({ fullPath, relPath, dirent: item });
    if (item.isDirectory()) walk(fullPath, entries);
  }
  return entries;
}

function listFiles() {
  return walk().filter((entry) => entry.dirent.isFile());
}

function fail(errors, message) {
  errors.push(message);
}

const autoSyncGeneratedSurfacesWorkflowPath = '.github/workflows/auto-sync-generated-surfaces.yml';
const sourceWatchPrWorkflowPath = '.github/workflows/source-watch-pr.yml';
const sourceWatchPrNotificationRule = 'Scheduled source-watch is PR-notification-only. It may compare active third-party SOURCE-LOCK pins with upstream GitHub commits and open or update a stable review PR. It must not copy upstream files, update SOURCE-LOCK pins, execute upstream code, auto-merge, push to main, run live n8n actions, or treat the notification PR as approval to change source. Real source updates require a separate human-approved PR after review.';
const autoSyncGeneratedAgentRuleTemplateOutputs = [
  '_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md',
  '_projects/development/ai-coding-agent-rules/_main/CLAUDE.template.md',
  '_projects/development/ai-coding-agent-rules/_main/GEMINI.template.md'
];
const activeRootInstructionOutputs = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.agents/rules/00-agent-toolkit-bootstrap.md'
];
const currentContractBegin = '<!-- AI-AGENT-TOOLKIT:_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/source-of-truth-contract.md:BEGIN SOURCE-OF-TRUTH-CONTRACT v1 -->';
const staleManagedMarkerOutputs = [
  '<!-- AI-AGENT-TOOLKIT:repo/docs/partials/source-of-truth-contract.md:BEGIN SOURCE-OF-TRUTH-CONTRACT v1 -->',
  '<!-- AI-AGENT-TOOLKIT:repo/docs/partials/source-of-truth-contract.md:END SOURCE-OF-TRUTH-CONTRACT -->',
  '<!-- ai-agent-toolkit:development.ai-coding-agent-rules:BEGIN ai-coding-agent-execution v1 -->',
  '<!-- ai-agent-toolkit:development.ai-coding-agent-rules:END ai-coding-agent-execution -->',
  '<!-- ai-agent-toolkit:development.ai-coding-agent-rules:BEGIN n8n-adapter v1 -->',
  '<!-- ai-agent-toolkit:development.ai-coding-agent-rules:END n8n-adapter -->',
  '<!-- ai-agent-toolkit:repo-methodology.context-preserving-ai-publisher:BEGIN source-of-truth-contract v1 -->',
  '<!-- ai-agent-toolkit:repo-methodology.context-preserving-ai-publisher:END source-of-truth-contract -->',
  '<!-- AI-AGENT-TOOLKIT:BEGIN toolkit v1 -->',
  '<!-- AI-AGENT-TOOLKIT:END toolkit -->',
  '<!-- AI-AGENT-TOOLKIT:BEGIN n8n-adapter v1 -->',
  '<!-- AI-AGENT-TOOLKIT:END n8n-adapter v1 -->',
  '<!-- AI-AGENT-TOOLKIT:END n8n-adapter -->',
  '<!-- BEGIN SOURCE-OF-TRUTH-CONTRACT -->',
  '<!-- END SOURCE-OF-TRUTH-CONTRACT -->'
];
const allowedCredentialExampleJsonPaths = new Set([
  '_projects/cicd/secure-installer/_main/docs/n8n/n8n-credential-migration-map.example.json'
]);

function isAutoSyncGeneratedOutputPath(relPath) {
  const rel = slash(relPath);
  return (
    rel === 'README.md' ||
    rel.startsWith('skills/') ||
    rel.startsWith('mcp/') ||
    autoSyncGeneratedAgentRuleTemplateOutputs.includes(rel)
  );
}

function assertExpectedFiles(errors) {
  for (const relPath of expectedFiles) {
    if (!existsRel(relPath)) fail(errors, `Missing expected file: ${relPath}`);
  }
  for (const relPath of expectedDirs) {
    if (!existsRel(relPath) || !fs.statSync(resolveRel(relPath)).isDirectory()) {
      fail(errors, `Missing expected directory: ${relPath}`);
    }
  }
}

function validateForbiddenFiles(errors) {
  for (const entry of walk()) {
    const rel = entry.relPath;
    const name = path.basename(rel);
    const lower = rel.toLowerCase();

    if (entry.dirent.isDirectory()) {
      if (rel.startsWith('.agents/rules/')) {
        fail(errors, `Unexpected .agents/rules entry: ${rel}. Only .agents/rules/00-agent-toolkit-bootstrap.md is allowed.`);
      }
      if (['_dist', 'dist', 'node_modules', 'coverage'].includes(name)) {
        fail(errors, `Forbidden directory present: ${rel}`);
      }
      continue;
    }

    if (rel.startsWith('.agents/rules/') && rel !== '.agents/rules/00-agent-toolkit-bootstrap.md') {
      fail(errors, `Unexpected .agents/rules entry: ${rel}. Only .agents/rules/00-agent-toolkit-bootstrap.md is allowed.`);
    }

    if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) fail(errors, `Forbidden env file: ${rel}`);
    if (lower.endsWith('.zip') || lower.endsWith('.tgz')) fail(errors, `Generated package artifact present: ${rel}`);
    if (lower.endsWith('.live-export.json') || lower.endsWith('.live-import.json')) fail(errors, `Live n8n import/export file present: ${rel}`);
    const safeExampleJson = allowedCredentialExampleJsonPaths.has(lower);
    if (!safeExampleJson && (lower.endsWith('.credentials.json') || lower.endsWith('.credential.json') || lower.endsWith('.credential.json'))) fail(errors, `Credential file present: ${rel}`);
    if (!safeExampleJson && /credential.*\.json$/i.test(name) && !lower.endsWith('package.json')) fail(errors, `Credential-looking JSON file present: ${rel}`);
    if (/binding.*\.json$/i.test(name)) fail(errors, `Credential binding-looking JSON file present: ${rel}`);
    if (['.pem', '.key', '.p12', '.pfx'].some((ext) => lower.endsWith(ext))) fail(errors, `Private key/certificate file present: ${rel}`);
    if (name === 'id_rsa' || name === 'id_ed25519') fail(errors, `Private SSH key present: ${rel}`);
    if (name.toLowerCase() === packYamlText) fail(errors, `${packYamlText} is not allowed: ${rel}`);
  }
}

function listGitTrackedFiles() {
  if (!fs.existsSync(path.join(root, '.git'))) return [];
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.split('\0').filter(Boolean).map(slash);
}

function validateTrackedLocalRuntimeFiles(errors) {
  for (const rel of listGitTrackedFiles()) {
    const segments = rel.split('/');
    if (segments.some((segment) => ignoredLocalDirs.has(segment))) {
      fail(errors, `Tracked local runtime file is not allowed: ${rel}`);
    }
  }
}

function validateJsonRegistries(errors) {
  for (const relPath of registryFiles) {
    let parsed;
    try {
      parsed = readJson(relPath);
    } catch (error) {
      fail(errors, `${relPath} is not valid JSON: ${error.message}`);
      continue;
    }

    const entries = Array.isArray(parsed) ? parsed : parsed.consumers || [];
    for (const entry of entries) {
      const paths = [];
      if (entry.path) paths.push(entry.path);
      if (entry.pack_json) paths.push(entry.pack_json);
      if (entry.module_path) paths.push(entry.module_path);
      if (entry.main_path) paths.push(entry.main_path);
      if (entry.exports_path) paths.push(entry.exports_path);
      if (Array.isArray(entry.root_surfaces)) paths.push(...entry.root_surfaces);
      for (const rel of paths) {
        if (!existsRel(rel)) fail(errors, `${relPath} references missing path: ${rel}`);
      }
    }
  }

  const yamlRegistries = listFiles().filter((entry) =>
    entry.relPath.startsWith('mcp/registry/') && /\.(ya?ml)$/i.test(entry.relPath)
  );
  for (const entry of yamlRegistries) fail(errors, `YAML registry file is not allowed: ${entry.relPath}`);
}

function validateRootTopology(errors) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (ignoredLocalDirs.has(entry.name)) continue;
    if (!allowedRootEntries.has(entry.name)) {
      fail(errors, `Unexpected root entry: ${entry.name}`);
    }
  }
}

function validateSourceRepoRegistry(errors) {
  const retiredInternalSourceRepos = retiredInternalSourceReposFromLocks();
  let registry;
  try {
    registry = readJson('mcp/registry/source-repos.registry.json');
  } catch (error) {
    fail(errors, `mcp/registry/source-repos.registry.json is not valid JSON: ${error.message}`);
    return;
  }
  if (!Array.isArray(registry)) {
    fail(errors, 'mcp/registry/source-repos.registry.json must be an array');
    return;
  }

  for (const entry of registry) {
    if (retiredInternalSourceRepos.has(entry.source)) {
      fail(errors, `mcp/registry/source-repos.registry.json retired internal repo must not be listed as active source-watch target: ${entry.source}`);
    }
    const thirdParty = activeThirdPartySources.get(entry.source);
    if (!thirdParty) continue;
    if (entry.risk !== thirdParty.risk) {
      fail(errors, `mcp/registry/source-repos.registry.json active third-party source missing risk metadata: ${entry.source}`);
    }
    if (entry.review_policy !== thirdParty.review_policy) {
      fail(errors, `mcp/registry/source-repos.registry.json active third-party source missing manual-review metadata: ${entry.source}`);
    }
    if (!thirdParty.requiredStatus.test(entry.status || '')) {
      fail(errors, `mcp/registry/source-repos.registry.json active third-party source missing attribution status: ${entry.source}`);
    }
    if (!thirdParty.requiredRole.test(entry.role || '')) {
      fail(errors, `mcp/registry/source-repos.registry.json active third-party source missing attribution role: ${entry.source}`);
    }
    if (!entry.last_reviewed) {
      fail(errors, `mcp/registry/source-repos.registry.json active third-party source missing last_reviewed: ${entry.source}`);
    }
  }
}

function pathsFromPackValue(value, paths = []) {
  if (typeof value === 'string') paths.push(value);
  else if (Array.isArray(value)) value.forEach((item) => pathsFromPackValue(item, paths));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => pathsFromPackValue(item, paths));
  return paths;
}

function validatePacks(errors) {
  const packFiles = listFiles().filter((entry) => entry.relPath.endsWith('/pack.json'));
  const required = ['id', 'title', 'description', 'status', 'risk_level', 'source_refs', 'suitable_for', 'installs', 'writes_allowed', 'writes_denied', 'requires_approval', 'run_commands', 'notes'];

  for (const entry of packFiles) {
    let pack;
    try {
      pack = readJson(entry.relPath);
    } catch (error) {
      fail(errors, `${entry.relPath} is not valid JSON: ${error.message}`);
      continue;
    }
    for (const key of required) {
      if (!(key in pack)) fail(errors, `${entry.relPath} is missing ${key}`);
    }
    if (pack.requires_approval !== true) fail(errors, `${entry.relPath} must require approval`);
    if (pack.run_commands !== false) fail(errors, `${entry.relPath} must not run commands by default`);
    for (const rel of pathsFromPackValue(pack.installs || [])) {
      if (!existsRel(rel)) fail(errors, `${entry.relPath} references missing install path: ${rel}`);
    }
  }
}

function parseFrontMatter(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;
  const body = text.slice(4, end).trim();
  const result = {};
  for (const line of body.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

function skillDirs() {
  const result = [];
  const skillsRoot = resolveRel('skills');
  if (!fs.existsSync(skillsRoot)) return result;
  for (const skill of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (skill.isDirectory()) result.push(slash(path.relative(root, path.join(skillsRoot, skill.name))));
  }
  return result.sort();
}

function validateSkills(errors) {
  for (const skillDir of skillDirs()) {
    const readme = `${skillDir}/README.md`;
    const skillFile = `${skillDir}/SKILL.md`;
    if (!existsRel(readme)) fail(errors, `${skillDir} missing README.md`);
    if (!existsRel(skillFile)) {
      fail(errors, `${skillDir} missing SKILL.md`);
      continue;
    }
    const frontMatter = parseFrontMatter(readText(skillFile));
    if (!frontMatter) {
      fail(errors, `${skillFile} missing front matter`);
      continue;
    }
    if (!frontMatter.name) fail(errors, `${skillFile} missing front matter name`);
    if (!frontMatter.description) fail(errors, `${skillFile} missing front matter description`);
    const folderName = path.basename(skillDir);
    if (frontMatter.name && frontMatter.name !== folderName) {
      fail(errors, `${skillFile} front matter name "${frontMatter.name}" does not match folder "${folderName}"`);
    }
  }

  const designSkill = 'skills/ui-ux-secure-frontend-design/SKILL.md';
  const expectedDescription = 'Security-first frontend UI/UX design skill for creating, reviewing, and improving web interfaces. Use for design systems, landing pages, SaaS dashboards, forms, component planning, accessibility, responsive polish, privacy-safe UX, and implementation review.';
  const designMatter = parseFrontMatter(readText(designSkill));
  if (designMatter?.name !== 'ui-ux-secure-frontend-design') fail(errors, 'Design skill front matter name is not approved');
  if (designMatter?.description !== expectedDescription) fail(errors, 'Design skill front matter description is not approved');

  const openai = readText('skills/ui-ux-secure-frontend-design/agents/openai.yaml').trim() + '\n';
  const expectedOpenai = [
    'interface:',
    '  display_name: "Secure UI/UX Frontend Design"',
    '  short_description: "Design and review polished, privacy-safe web frontends."',
    '  brand_color: "#7C3AED"',
    '',
    'policy:',
    '  allow_implicit_invocation: true',
    ''
  ].join('\n');
  if (openai !== expectedOpenai) fail(errors, 'Design skill agents/openai.yaml does not match approved shape');

  for (const entry of listFiles().filter((item) => item.relPath.startsWith('skills/ui-ux-secure-frontend-design/') && item.relPath.endsWith('.md'))) {
    const raw = fs.readFileSync(entry.fullPath, 'utf8');
    if (raw.includes('\r\n')) fail(errors, `Design skill Markdown is not LF-normalized: ${entry.relPath}`);
  }
}

function validateExecutables(errors) {
  for (const entry of listFiles()) {
    const rel = entry.relPath;
    const ext = path.extname(rel).toLowerCase();
    if (!executableExtensions.has(ext)) continue;
    const isProjectMainSource = /^_projects\/[^/]+\/[^/]+\/_main\//.test(rel);
    if (isProjectMainSource) continue;
    if (ext === '.py') {
      const allowedPython =
        rel.startsWith('skills/ui-ux-secure-frontend-design/tools/design-system-generator/scripts/') ||
        rel.startsWith('skills/ui-ux-secure-frontend-design/tools/design-system-generator/tests/') ||
        rel.startsWith('repo/tests/');
      if (!allowedPython) fail(errors, `Python file outside approved locations: ${rel}`);
    }
    const allowed = allowedExecutablePrefixes.some((prefix) => rel.startsWith(prefix));
    if (!allowed) fail(errors, `Executable file outside approved locations: ${rel}`);
  }
}

function validateDesignGeneratorLocalOnly(errors) {
  const requiredData = [
    'styles.csv',
    'colors.csv',
    'charts.csv',
    'landing.csv',
    'products.csv',
    'ux-guidelines.csv',
    'typography.csv',
    'icons.csv',
    'react-performance.csv',
    'app-interface.csv',
    'google-fonts.csv',
    'ui-reasoning.csv'
  ];
  const requiredStacks = [
    'react.csv',
    'nextjs.csv',
    'vue.csv',
    'svelte.csv',
    'astro.csv',
    'swiftui.csv',
    'react-native.csv',
    'flutter.csv',
    'nuxtjs.csv',
    'nuxt-ui.csv',
    'html-tailwind.csv',
    'shadcn.csv',
    'jetpack-compose.csv',
    'threejs.csv',
    'angular.csv',
    'laravel.csv'
  ];
  for (const file of requiredData) {
    if (!existsRel(`skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/${file}`)) fail(errors, `Missing design generator data file: ${file}`);
  }
  for (const file of requiredStacks) {
    if (!existsRel(`skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/stacks/${file}`)) fail(errors, `Missing design generator stack data file: ${file}`);
  }

  const scriptFiles = listFiles().filter((entry) =>
    entry.relPath.startsWith('skills/ui-ux-secure-frontend-design/tools/design-system-generator/scripts/') && entry.relPath.endsWith('.py')
  );

  for (const entry of scriptFiles) {
    const text = fs.readFileSync(entry.fullPath, 'utf8').toLowerCase();
    for (const token of designGeneratorForbiddenTokens) {
      if (text.includes(token)) {
        fail(errors, `Design generator script contains forbidden local-only token "${token}": ${entry.relPath}`);
      }
    }
  }

  const licenseNotes = readText('skills/ui-ux-secure-frontend-design/tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md');
  if (!licenseNotes.includes('nextlevelbuilder/ui-ux-pro-max-skill') || !licenseNotes.includes('MIT')) {
    fail(errors, 'Design generator third-party licence notes must mention upstream project and MIT licence');
  }
}

function validateProjectModules(errors) {
  const result = projectSync.validateAndSync();
  for (const error of result.errors) fail(errors, error);
}

function validateDocContract(errors) {
  const result = docContractSync.validateAndSync({ mode: 'check' });
  for (const error of result.errors) fail(errors, error);
}

function validateAgentInstructionShims(errors) {
  const result = agentInstructionSync.validateAndSync({ mode: 'check' });
  for (const error of result.errors) fail(errors, error);
}

function validateReadmeSurface(errors) {
  const text = readText('README.md');
  const requiredSections = [
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
  let lastIndex = -1;
  for (const section of requiredSections) {
    const index = text.indexOf(section);
    if (index === -1) {
      fail(errors, `README.md missing required section: ${section.slice(3)}`);
      continue;
    }
    if (index < lastIndex) fail(errors, `README.md section is out of order: ${section.slice(3)}`);
    lastIndex = index;
  }
  const appendixIndex = text.indexOf('## Appendix: Source-of-Truth Contract');
  const contractIndex = text.indexOf(currentContractBegin);
  if (appendixIndex === -1 || contractIndex === -1 || contractIndex < appendixIndex) {
    fail(errors, 'README.md source-of-truth contract block must live under the appendix');
  }
  if (!text.includes('skills/') || !text.includes('mcp/')) {
    fail(errors, 'README.md must use root-level skills/ and mcp/ surfaces');
  }
  if (removedForAiPathPattern.test(text)) {
    fail(errors, 'README.md must not reference the removed legacy AI surface');
  }
  for (const surface of ['packs', 'playbooks', 'templates', 'registries', 'registry', 'tools']) {
    const primaryRow = new RegExp(`\\|\\s+\`?${surface}/?\`?\\s+\\|`, 'i');
    if (primaryRow.test(text)) fail(errors, `README.md must not present ${surface}/ as a primary user-facing entrypoint`);
  }
}

function validateProjectLandingCards(errors) {
  const projectReadmes = listFiles().filter((entry) =>
    /^_projects\/[^/]+\/[^/]+\/README\.md$/.test(entry.relPath)
  );

  for (const entry of projectReadmes) {
    const text = fs.readFileSync(entry.fullPath, 'utf8').replace(/\r\n/g, '\n');
    const lines = text.trimEnd().split('\n');
    if (lines.length > 30 || text.length > 1800 || /```/.test(text)) {
      fail(errors, `${entry.relPath} project README must stay a tiny landing card`);
    }
    if (!/\[[^\]\n]+\]\(_main\/?\)/.test(text)) {
      fail(errors, `${entry.relPath} project README must link to _main/`);
    }
    const playbooksCanonical =
      /(^|[^A-Za-z0-9_])playbooks\/?[^\n.]{0,140}\b(canonical|source[- ]of[- ]truth|human documentation|human docs|source layer)\b/i.test(text) ||
      /\b(canonical|source[- ]of[- ]truth|human documentation|human docs|source layer)\b[^\n.]{0,140}(^|[^A-Za-z0-9_])playbooks\/?/i.test(text);
    if (playbooksCanonical) {
      fail(errors, `${entry.relPath} must not claim playbooks are canonical human documentation`);
    }
  }
}

function projectManifests() {
  return projectSync.projectManifests();
}

function validateSourceLocks(errors) {
  const result = sourceLockAudit.auditSourceLocks();
  for (const error of result.errors) fail(errors, error);
}

function validateSkillPortability(errors) {
  const result = skillPortabilityAudit.auditSkillPortability();
  for (const error of result.errors) fail(errors, error);
}

function validateAgentRuleSources(errors) {
  const rootPartialFiles = listFiles().filter((entry) => /\/_partials\//.test(entry.relPath));
  for (const entry of rootPartialFiles) {
    if (entry.relPath.startsWith('skills/')) fail(errors, `Agent-rule partials must stay in project _main source, not published skill folders: ${entry.relPath}`);
  }
  for (const entry of walk()) {
    if (entry.relPath === '_projects/development/ai-coding-agent-rules/_main/repo-local' ||
        entry.relPath.startsWith('_projects/development/ai-coding-agent-rules/_main/repo-local/')) {
      fail(errors, `Repo-local skill runtime templates must live under curated_output_for_ai, not _main: ${entry.relPath}`);
    }
  }
  for (const relPath of [
    'skills/ai-coding-agent-rules/AGENTS.template.md',
    'skills/ai-coding-agent-rules/CLAUDE.template.md',
    'skills/ai-coding-agent-rules/GEMINI.template.md',
    'skills/ai-coding-agent-rules/antigravity-bootstrap.template.md'
  ]) {
    if (existsRel(relPath)) fail(errors, `Removed top-level ai-coding-agent-rules template alias is still present: ${relPath}`);
  }
  for (const relPath of [
    'AGENTS.md',
    'README.md',
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
    'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'
  ]) {
    if (!existsRel(relPath)) continue;
    const text = readText(relPath);
    for (const marker of staleManagedMarkerOutputs) {
      if (text.includes(marker)) fail(errors, `${relPath} contains stale generic managed marker: ${marker}`);
    }
  }
}

function validateNoActiveAgentInstructionFilesInSkills(errors) {
  for (const entry of listFiles()) {
    if (!entry.relPath.startsWith('skills/')) continue;
    if (/\/(?:AGENTS|CLAUDE|GEMINI)\.md$/.test(entry.relPath)) {
      fail(errors, `Skill folder must use inert agent-rule template filenames: ${entry.relPath}`);
    }
  }
}

function validateStaleReferences(errors) {
  const roots = new Set(staleReferenceRoots);
  for (const entry of listFiles()) {
    if (entry.relPath.includes('/_main/')) continue;
    if (entry.relPath.startsWith('skills/ui-ux-secure-frontend-design/tools/design-system-generator/data/')) continue;
    if (entry.relPath.startsWith('skills/ui-ux-secure-frontend-design/tools/design-system-generator/scripts/')) continue;
    const top = entry.relPath.split('/')[0];
    if (!roots.has(top) && !roots.has(entry.relPath)) continue;
    const text = fs.readFileSync(entry.fullPath, 'utf8');
    if (text.includes(registryYamlText) || text.includes('mcp/registry/*.' + 'yaml') || text.includes('mcp/registry/skills.' + 'yaml') || text.includes('mcp/registry/guides.' + 'yaml')) {
      fail(errors, `Stale registry YAML reference found in ${entry.relPath}`);
    }
    if (text.includes(packYamlText)) fail(errors, `Stale pack YAML reference found in ${entry.relPath}`);
    if (staleProjectExportsPath.test(text)) fail(errors, `Stale project exports path reference found in ${entry.relPath}`);
    if (/(?:must|required|mandatory)[^\n.]{0,160}`?exports\/`?|`?exports\/`?[^\n.]{0,160}(?:must|required|mandatory)/i.test(text)) {
      fail(errors, `Stale mandatory exports architecture wording found in ${entry.relPath}`);
    }
    for (const token of ['known-' + 'repos', 'Known Repo ' + 'Patterns', 'ian-trending-' + 'system']) {
      if (text.includes(token)) fail(errors, `Stale project-specific reference "${token}" found in ${entry.relPath}`);
    }
    for (const pattern of staleRootSurfacePatterns) {
      if (pattern.regex.test(text)) fail(errors, `Stale ${pattern.label} reference found in ${entry.relPath}`);
    }
  }
}

function validateSecretStrings(errors) {
  for (const entry of listFiles()) {
    const text = fs.readFileSync(entry.fullPath, 'utf8');
    for (const pattern of secretPatterns) {
      if (pattern.regex.test(text)) fail(errors, `${entry.relPath} contains possible secret: ${pattern.label}`);
    }
  }
}

function workflowPermissionLines(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^permissions:\s*$/.test(line));
  if (start === -1) return null;
  const permissions = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line) && line.trim() !== '') break;
    if (line.trim() === '') continue;
    if (/^\s*#/.test(line)) continue;
    const match = line.match(/^  ([A-Za-z-]+):\s*([A-Za-z-]+)\s*(?:#.*)?$/);
    if (match) permissions.push(`${match[1]}: ${match[2]}`);
    else permissions.push(`__unparsed__: ${line.trim()}`);
  }
  return permissions;
}

function validateNoOldForAiReferences(errors) {
  const files = listFiles().filter((entry) => {
    const rel = entry.relPath;
    if (rel.includes('/_main/') || rel.includes('/curated_output_for_ai/')) return false;
    if (rel.startsWith('repo/tests/')) return false;
    return (
      rel === 'README.md' ||
      rel === 'AGENTS.md' ||
      rel === 'package.json' ||
      rel.startsWith('.github/') ||
      rel.startsWith('repo/docs/') ||
      rel.startsWith('repo/scripts/') ||
      rel.startsWith('skills/') ||
      rel.startsWith('mcp/')
    );
  });
  for (const entry of files) {
    const text = fs.readFileSync(entry.fullPath, 'utf8');
    if (removedForAiPathPattern.test(text)) {
      fail(errors, `${entry.relPath} references removed legacy AI surface path`);
    }
  }
}

function workflowStepBlocks(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const steps = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(/^      - name:\s*(.+?)\s*$/);
    if (match) {
      if (current) steps.push(current);
      current = { name: match[1], text: `${line}\n` };
      continue;
    }
    if (current) current.text += `${line}\n`;
  }
  if (current) steps.push(current);
  return steps;
}

function workflowStepText(steps, name) {
  const step = steps.find((candidate) => candidate.name === name);
  return step ? step.text : '';
}

function workflowStepUses(stepText) {
  const match = stepText.match(/^\s*uses:\s*([^\s#]+)\s*$/m);
  return match ? match[1].replace(/^['"]|['"]$/g, '') : '';
}

function workflowRunCommands(stepText) {
  const lines = stepText.replace(/\r\n/g, '\n').split('\n');
  const runIndex = lines.findIndex((line) => /^\s*run:\s*\|\s*$/.test(line));
  if (runIndex === -1) return [];
  return lines
    .slice(runIndex + 1)
    .map((line) => line.trim())
    .filter(Boolean);
}

const shellEnvAssignmentPrefix = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"\n]*"|'[^'\n]*'|[^\s#;]+)\s+)*`;
const shellCommandStartPrefix = String.raw`^\s*(?:run:\s*)?(?:env\s+)?${shellEnvAssignmentPrefix}`;
const packageManagerCommandPrefix = String.raw`(?:[^\s#;]+/)?`;
const npmValidateAllCommandPattern = new RegExp(`${shellCommandStartPrefix}${packageManagerCommandPrefix}npm(?:\\.cmd)?\\s+run\\s+validate:all\\b`, 'm');
const packageManagerCommandPattern = new RegExp(`${shellCommandStartPrefix}${packageManagerCommandPrefix}(?:npm|pnpm|yarn)(?:\\.cmd)?(?:\\s|$)`, 'm');
const explicitValidationWorkflowCommands = [
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

function validateReadOnlyValidationWorkflow(entry, text, errors) {
  const permissions = workflowPermissionLines(text) || [];
  const expectedPermissions = ['contents: read'];
  if (permissions.length !== expectedPermissions.length || expectedPermissions.some((permission) => !permissions.includes(permission))) {
    fail(errors, `${entry.relPath} must grant only contents: read`);
  }

  if (npmValidateAllCommandPattern.test(text)) {
    fail(errors, `${entry.relPath} must use explicit validation commands instead of npm run validate:all`);
  }

  const steps = workflowStepBlocks(text);
  const validationStep = workflowStepText(steps, 'Run validation');
  const commands = workflowRunCommands(validationStep);
  if (commands.length !== explicitValidationWorkflowCommands.length ||
      explicitValidationWorkflowCommands.some((command, index) => commands[index] !== command)) {
    fail(errors, `${entry.relPath} must run the canonical explicit validation command list`);
  }

  if (/sync-repo-doc-contract\.cjs\s+--write/.test(text) || /sync-toolkit-projects\.cjs\s+--write/.test(text)) {
    fail(errors, `${entry.relPath} must not write generated outputs`);
  }
}

function validateAutoSyncGeneratedSurfacesWorkflow(entry, text, errors) {
  const permissions = workflowPermissionLines(text) || [];
  const expectedPermissions = ['contents: write', 'pull-requests: read'];
  if (permissions.length !== expectedPermissions.length || expectedPermissions.some((permission) => !permissions.includes(permission))) {
    fail(errors, `${entry.relPath} must grant only contents: write and pull-requests: read`);
  }

  if (/^\s{2}pull_request:\s*$/m.test(text)) fail(errors, `${entry.relPath} must not use pull_request`);
  if (/^\s{2}push:\s*$/m.test(text)) fail(errors, `${entry.relPath} must not trigger on push`);
  if (/^\s{2}schedule:\s*$/m.test(text)) fail(errors, `${entry.relPath} must not trigger on schedule`);
  if (/^\s{2}workflow_run:\s*$/m.test(text)) fail(errors, `${entry.relPath} must not trigger on workflow_run`);
  if (/^\s{2}workflow_dispatch:\s*$/m.test(text)) fail(errors, `${entry.relPath} must not trigger on workflow_dispatch`);
  if (!/^\s{2}pull_request_target:\s*$/m.test(text)) fail(errors, `${entry.relPath} must use pull_request_target`);

  if (!/github\.event\.pull_request\.head\.repo\.full_name == github\.repository/.test(text)) {
    fail(errors, `${entry.relPath} missing same-repo PR guard`);
  }
  if (!/github\.event\.pull_request\.head\.ref != 'main'/.test(text)) {
    fail(errors, `${entry.relPath} missing head.ref != main guard`);
  }
  if (!text.includes('HEAD_SHA: ${{ github.event.pull_request.head.sha }}')) {
    fail(errors, `${entry.relPath} missing guarded PR head SHA environment variable`);
  }

  if (/repo\/scripts\/(?:watch-project-sources|safe-source-update)\.cjs/i.test(text)) {
    fail(errors, `${entry.relPath} must not run source-watch or source-update scripts`);
  }
  if (/\bn8n\s+(?:import|export)\b|(?:import|export)-n8n-workflows-live|docker\s+exec[^\n]*\bn8n\b/i.test(text)) {
    fail(errors, `${entry.relPath} must not run live n8n import/export`);
  }

  const steps = workflowStepBlocks(text);
  const preflightIndex = text.indexOf('- name: Preflight guard');
  const trustedCheckoutIndex = text.indexOf('- name: Checkout trusted base revision');
  const prCheckoutIndex = text.indexOf('- name: Checkout PR head commit');
  const usesSteps = steps
    .map((step, index) => ({ name: step.name, index, text: step.text, textIndex: text.indexOf(`      - name: ${step.name}`), uses: workflowStepUses(step.text) }))
    .filter((step) => step.uses);
  const requiredAutoSyncActionReferences = [
    { stepName: 'Checkout trusted base revision', expectedUses: 'actions/checkout@v6' },
    { stepName: 'Checkout PR head commit', expectedUses: 'actions/checkout@v6' },
    { stepName: 'Set up Node.js', expectedUses: 'actions/setup-node@v6' }
  ];
  const expectedUsesByStepName = new Map(requiredAutoSyncActionReferences.map(({ stepName, expectedUses }) => [stepName, expectedUses]));
  if (
    usesSteps.length !== requiredAutoSyncActionReferences.length ||
    usesSteps.some((step) => !expectedUsesByStepName.has(step.name))
  ) {
    fail(errors, `${entry.relPath} must allow only the reviewed uses action steps`);
  }
  const checkoutSteps = usesSteps.filter((step) => step.uses.startsWith('actions/checkout@'));
  const checkoutIndex = checkoutSteps
    .map((step) => step.textIndex)
    .filter((index) => index !== -1)
    .sort((a, b) => a - b)[0] ?? -1;
  const preflightStepOrder = steps.findIndex((step) => step.name === 'Preflight guard');
  const checkoutStepOrders = checkoutSteps.map((step) => step.index);
  if (preflightStepOrder === -1 || checkoutStepOrders.length === 0 || checkoutStepOrders.some((index) => index < preflightStepOrder)) {
    fail(errors, `${entry.relPath} must run preflight before any checkout`);
  }
  if (trustedCheckoutIndex === -1 || prCheckoutIndex === -1 || trustedCheckoutIndex < preflightIndex || prCheckoutIndex < preflightIndex) {
    fail(errors, `${entry.relPath} must check out trusted base and PR workspaces only after preflight`);
  }
  const trustedCheckoutStep = workflowStepText(steps, 'Checkout trusted base revision');
  const prCheckoutStep = workflowStepText(steps, 'Checkout PR head commit');
  const setupNodeStep = workflowStepText(steps, 'Set up Node.js');
  for (const { stepName, expectedUses } of requiredAutoSyncActionReferences) {
    const matchingUsesSteps = usesSteps.filter((step) => step.name === stepName);
    if (matchingUsesSteps.length !== 1) {
      fail(errors, `${entry.relPath} must contain exactly one ${stepName} uses action step`);
      continue;
    }
    const stepText = matchingUsesSteps[0].text;
    if (workflowStepUses(stepText) !== expectedUses) {
      fail(errors, `${entry.relPath} ${stepName} must use ${expectedUses}`);
    }
  }
  if (!trustedCheckoutStep.includes('repository: ${{ github.repository }}') ||
      !trustedCheckoutStep.includes('ref: ${{ github.event.pull_request.base.sha }}') ||
      !trustedCheckoutStep.includes('path: trusted')) {
    fail(errors, `${entry.relPath} must check out the trusted base SHA to trusted/`);
  }
  if (prCheckoutStep.includes('ref: ${{ github.event.pull_request.head.ref }}')) {
    fail(errors, `${entry.relPath} must not check out the PR branch by mutable head.ref`);
  }
  if (!prCheckoutStep.includes('repository: ${{ github.event.pull_request.head.repo.full_name }}') ||
      !prCheckoutStep.includes('ref: ${{ github.event.pull_request.head.sha }}') ||
      !prCheckoutStep.includes('path: pr')) {
    fail(errors, `${entry.relPath} must check out the guarded PR head SHA to pr/`);
  }
  if (/persist-credentials:\s*true/i.test(text)) {
    fail(errors, `${entry.relPath} must not use persisted checkout credentials`);
  }
  if (!/persist-credentials:\s*false/i.test(text)) {
    fail(errors, `${entry.relPath} checkout must disable persisted credentials`);
  }
  if (/git\s+diff\s+--name-only\s+["']?\$BASE_SHA["']?\s+HEAD/.test(text)) {
    fail(errors, `${entry.relPath} must not compute PR changed files with git diff against the PR branch`);
  }
  const apiIndex = text.indexOf('gh api --paginate');
  if (apiIndex === -1 || apiIndex > checkoutIndex || !text.includes('pulls/${PR_NUMBER}/files') || !text.includes("--jq '.[].filename'")) {
    fail(errors, `${entry.relPath} must query PR changed files before checkout`);
  }
  for (const step of steps) {
    const hasToken = step.text.includes('${{ github.token }}');
    if (hasToken && !['Preflight guard', 'Push generated surfaces'].includes(step.name)) {
      fail(errors, `${entry.relPath} must expose github.token only to preflight and final push steps`);
    }
  }
  if (/^\s*node\s+repo\/scripts\//m.test(text)) {
    fail(errors, `${entry.relPath} must not execute maintenance scripts from the default or PR workspace`);
  }
  if (/\$PR_ROOT\/repo\/scripts\//.test(text)) {
    fail(errors, `${entry.relPath} must not execute maintenance scripts from the PR workspace`);
  }
  if (/validate-toolkit\.cjs[^\n]*--workspace\s+"\$PR_ROOT"/.test(text)) {
    fail(errors, `${entry.relPath} must not run full validation against the PR workspace`);
  }
  if (/(^|\s)(?:\/usr\/bin\/)?git\s+(?!-C\s+"\$PR_ROOT")/m.test(text)) {
    fail(errors, `${entry.relPath} git commands must explicitly target the PR workspace with /usr/bin/git -C "$PR_ROOT"`);
  }
  if (npmValidateAllCommandPattern.test(text)) {
    fail(errors, `${entry.relPath} must not run npm run validate:all in the privileged writeback workflow`);
  }
  if (packageManagerCommandPattern.test(text)) {
    fail(errors, `${entry.relPath} must not run npm, pnpm, or yarn in the privileged writeback workflow`);
  }
  if (/\bnode\s+--test\b/.test(text)) {
    fail(errors, `${entry.relPath} must not run generated Node test suites in the privileged writeback workflow`);
  }
  if (/\bpython(?:3)?\s+-m\s+unittest\b|\bpytest\b/.test(text)) {
    fail(errors, `${entry.relPath} must not run Python unit tests in the privileged writeback workflow`);
  }
  if (/skills\/ui-ux-secure-frontend-design\/tools\/design-system-generator\/tests|design-system-generator\/tests/.test(text)) {
    fail(errors, `${entry.relPath} must not run generated tool tests in the privileged writeback workflow`);
  }

  const preflightSection = preflightIndex === -1 || checkoutIndex === -1
    ? ''
    : text.slice(preflightIndex, checkoutIndex);
  if (!preflightSection.includes('gh api "repos/${REPOSITORY_FULL_NAME}/pulls/${PR_NUMBER}" --jq \'.head.sha\'') ||
      !preflightSection.includes('current_head_sha')) {
    fail(errors, `${entry.relPath} preflight must verify the current PR head SHA from PR metadata`);
  }
  if (!preflightSection.includes('"$current_head_sha" != "$HEAD_SHA"') ||
      !preflightSection.includes('PR head changed after this workflow was queued')) {
    fail(errors, `${entry.relPath} preflight must reject stale runs when the PR head SHA changed`);
  }
  if (!preflightSection.includes("gh api \"repos/${REPOSITORY_FULL_NAME}/pulls/${PR_NUMBER}\" --jq '.changed_files'") ||
      !preflightSection.includes('changed_file_count') ||
      !preflightSection.includes('changed_file_count > 3000') ||
      !preflightSection.includes("GitHub's PR files API is capped at 3000")) {
    fail(errors, `${entry.relPath} preflight must reject PRs with more than 3000 changed files before using the capped files API`);
  }
  const requiredPreflightPathBlocks = [
    { label: '.github', token: '.github/*' },
    { label: 'repo/docs', token: 'repo/docs/*' },
    { label: 'repo/scripts', token: 'repo/scripts/*' },
    { label: 'repo/tests', token: 'repo/tests/*' },
    { label: '_projects/**/_main', token: '_projects/*/_main/*' },
    { label: 'package/lockfile changes', token: 'package.json|package-lock.json|pnpm-lock.yaml|yarn.lock' }
  ];
  for (const { label, token } of requiredPreflightPathBlocks) {
    if (!preflightSection.includes(token)) fail(errors, `${entry.relPath} missing unsafe preflight fail handling for ${label}`);
  }
  const autoSyncContractInputs = [
    '_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/source-of-truth-contract.md'
  ];
  for (const token of autoSyncContractInputs) {
    const preflightOccurrences = preflightSection.split(token).length - 1;
    if (preflightOccurrences < 3) {
      fail(errors, `${entry.relPath} must allow source-of-truth contract partial changes as auto-sync eligible inputs`);
    }
  }
  const autoSyncAgentRulePartialInputs = [
    '_projects/development/ai-coding-agent-rules/_main/_partials/*'
  ];
  for (const token of autoSyncAgentRulePartialInputs) {
    if (!preflightSection.includes(token)) {
      fail(errors, `${entry.relPath} must allow agent-rule partial changes as auto-sync eligible inputs`);
    }
  }
  for (const token of autoSyncGeneratedAgentRuleTemplateOutputs) {
    if (!preflightSection.includes(token)) {
      fail(errors, `${entry.relPath} must allow generated source-side agent-rule templates in the guarded PR file set`);
    }
  }
  const unsafeSkipMessage = 'Auto-sync skipped: this PR touches source/maintenance paths that require manual generated-output commits. Normal Validate checks remain the merge gate.';
  const currentHeadCheckIndex = preflightSection.indexOf('current_head_sha="$(');
  const unsafeSkipIndex = preflightSection.indexOf(unsafeSkipMessage);
  if (currentHeadCheckIndex === -1 || unsafeSkipIndex === -1 || currentHeadCheckIndex > unsafeSkipIndex) {
    fail(errors, `${entry.relPath} preflight must reject stale PR heads before optional auto-sync skips`);
  }
  if (!preflightSection.includes(unsafeSkipMessage) ||
      !preflightSection.includes('echo "should_sync=false" >> "$GITHUB_OUTPUT"') ||
      !preflightSection.includes('should_sync=true') ||
      preflightSection.includes('Auto-sync refused: this PR mixes generated-sync-eligible changes') ||
      /Auto-sync skipped:[\s\S]{0,400}exit 1/.test(preflightSection) ||
      !/Auto-sync skipped:[\s\S]{0,400}exit 0/.test(preflightSection)) {
    fail(errors, `${entry.relPath} preflight must skip unsafe mixed maintenance/source PRs without writeback`);
  }

  if (!text.includes('Forbidden post-sync change outside generated output scope') ||
      !/git\s+-C\s+"\$PR_ROOT"\s+diff\s+--name-only/.test(text) ||
      !/git\s+-C\s+"\$PR_ROOT"\s+diff\s+--name-only\s+--cached/.test(text) ||
      !/git\s+-C\s+"\$PR_ROOT"\s+ls-files\s+--others\s+--exclude-standard/.test(text)) {
    fail(errors, `${entry.relPath} missing post-sync changed-path validation`);
  }
  const generatedOutputScope = 'README.md|skills/*|mcp/*';
  if (!text.includes(generatedOutputScope)) {
    fail(errors, `${entry.relPath} missing approved generated output path allowlist`);
  }
  for (const token of autoSyncGeneratedAgentRuleTemplateOutputs) {
    if (!text.includes(token)) fail(errors, `${entry.relPath} missing generated source-side agent-rule template allowlist entry: ${token}`);
  }

  const postSyncStep = workflowStepText(steps, 'Guard, stage, and snapshot generated write scope');
  const staticChecksStep = workflowStepText(steps, 'Static generated surface checks');
  const finalRecheckStep = workflowStepText(steps, 'Final pre-commit workspace recheck');
  const commitStep = workflowStepText(steps, 'Commit generated surfaces');
  const pushStep = workflowStepText(steps, 'Push generated surfaces');
  const verifyCheckoutStep = workflowStepText(steps, 'Verify checked-out PR commit');
  const verifyCheckoutIndex = text.indexOf('- name: Verify checked-out PR commit');
  const syncIndex = text.indexOf('- name: Sync deterministic generated surfaces');
  const gatedAfterPreflightSteps = [
    'Checkout trusted base revision',
    'Checkout PR head commit',
    'Verify checked-out PR commit',
    'Set up Node.js',
    'Sync deterministic generated surfaces',
    'Guard, stage, and snapshot generated write scope',
    'Static generated surface checks',
    'Final pre-commit workspace recheck',
    'Commit generated surfaces',
    'Push generated surfaces'
  ];
  for (const stepName of gatedAfterPreflightSteps) {
    const stepText = workflowStepText(steps, stepName);
    if (!stepText.includes("if: steps.preflight.outputs.should_sync == 'true'")) {
      fail(errors, `${entry.relPath} must skip checkout and writeback steps when preflight should_sync is false`);
    }
  }
  const generatedOutputGuardText = `${postSyncStep}\n${finalRecheckStep}`;
  for (const token of activeRootInstructionOutputs) {
    if (!generatedOutputGuardText.includes(`Privileged auto-sync must not`) || !generatedOutputGuardText.includes(token)) {
      fail(errors, `${entry.relPath} must fail closed instead of staging active root AI instruction files: ${token}`);
    }
  }
  const forbiddenGeneratedOutputAllowlistTokens = [
    '_projects/*',
    'repo/*',
    '.github/*',
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    '.gitignore',
    '.gitattributes'
  ];
  for (const token of forbiddenGeneratedOutputAllowlistTokens) {
    if (generatedOutputGuardText.includes(token)) {
      fail(errors, `${entry.relPath} must not allow broad generated output paths in post-sync guards: ${token}`);
    }
  }

  if (!verifyCheckoutStep.includes('/usr/bin/git -C "$PR_ROOT" rev-parse HEAD') ||
      !verifyCheckoutStep.includes('"$checked_out_sha" != "$HEAD_SHA"') ||
      !verifyCheckoutStep.includes('Checked-out PR commit does not match guarded head SHA')) {
    fail(errors, `${entry.relPath} must verify the checked-out PR commit matches HEAD_SHA`);
  }
  if (verifyCheckoutIndex === -1 || syncIndex === -1 || !(prCheckoutIndex < verifyCheckoutIndex && verifyCheckoutIndex < syncIndex)) {
    fail(errors, `${entry.relPath} must verify the checked-out PR commit before running sync`);
  }

  const trustedWorkspaceCommands = [
    'node "$TRUSTED_ROOT/repo/scripts/sync-agent-instruction-shims.cjs" --workspace "$PR_ROOT" --write',
    'node "$TRUSTED_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --workspace "$PR_ROOT" --write',
    'node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --write',
    'node "$TRUSTED_ROOT/repo/scripts/sync-agent-instruction-shims.cjs" --workspace "$PR_ROOT" --check',
    'node "$TRUSTED_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --workspace "$PR_ROOT" --check',
    'node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --check'
  ];
  for (const command of trustedWorkspaceCommands) {
    if (!text.includes(command)) {
      fail(errors, `${entry.relPath} must run trusted maintenance scripts with --workspace "$PR_ROOT"`);
    }
  }

  if (!postSyncStep || !postSyncStep.includes('expected_index_tree="$(/usr/bin/git -C "$PR_ROOT" write-tree)"') || !postSyncStep.includes('expected_index_tree=${expected_index_tree}')) {
    fail(errors, `${entry.relPath} must snapshot the staged index after the post-sync guard`);
  }
  const staticChecksIndex = text.indexOf('- name: Static generated surface checks');
  const finalRecheckIndex = text.indexOf('- name: Final pre-commit workspace recheck');
  const commitIndex = text.indexOf('- name: Commit generated surfaces');
  if (staticChecksIndex === -1 || finalRecheckIndex === -1 || commitIndex === -1 ||
      !(staticChecksIndex < finalRecheckIndex && finalRecheckIndex < commitIndex)) {
    fail(errors, `${entry.relPath} must recheck the workspace and staged index after validation and before commit`);
  }
  if (!finalRecheckStep.includes('/usr/bin/git -C "$PR_ROOT" ls-files --others --exclude-standard')) {
    fail(errors, `${entry.relPath} final recheck must reject untracked files before commit`);
  }
  if (!finalRecheckStep.includes('/usr/bin/git -C "$PR_ROOT" diff --quiet')) {
    fail(errors, `${entry.relPath} final recheck must reject unstaged tracked changes before commit`);
  }
  if (!finalRecheckStep.includes('current_index_tree="$(/usr/bin/git -C "$PR_ROOT" write-tree)"') ||
      !finalRecheckStep.includes('Staged generated output changed after the post-sync guard') ||
      !finalRecheckStep.includes('"$current_index_tree" != "${EXPECTED_INDEX_TREE}"')) {
    fail(errors, `${entry.relPath} final recheck must compare the staged index tree snapshot`);
  }
  if (!finalRecheckStep.includes('/usr/bin/git -C "$PR_ROOT" diff --cached --name-only') ||
      !finalRecheckStep.includes(generatedOutputScope) ||
      autoSyncGeneratedAgentRuleTemplateOutputs.some((token) => !finalRecheckStep.includes(token))) {
    fail(errors, `${entry.relPath} final recheck must reject staged paths outside generated output scope`);
  }
  const expectedStaticCheckCommands = [
    'node "$TRUSTED_ROOT/repo/scripts/sync-agent-instruction-shims.cjs" --workspace "$PR_ROOT" --check',
    'node "$TRUSTED_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --workspace "$PR_ROOT" --check',
    'node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --check',
    '/usr/bin/git -C "$PR_ROOT" diff --cached --check',
    '/usr/bin/git -C "$PR_ROOT" diff --check'
  ];
  const actualStaticCheckCommands = workflowRunCommands(staticChecksStep);
  if (actualStaticCheckCommands.length !== expectedStaticCheckCommands.length ||
      expectedStaticCheckCommands.some((command, index) => actualStaticCheckCommands[index] !== command)) {
    fail(errors, `${entry.relPath} static generated surface checks must be limited to sync freshness and git diff checks`);
  }

  const gitAddLines = (text.match(/^\s*(?:\/usr\/bin\/)?git(?:\s+-C\s+"\$PR_ROOT")?\s+add .+$/gm) || []).map((line) => line.trim());
  const expectedGitAddLine = `/usr/bin/git -C "$PR_ROOT" add README.md skills mcp ${autoSyncGeneratedAgentRuleTemplateOutputs.join(' ')}`;
  if (gitAddLines.length !== 1 || gitAddLines[0] !== expectedGitAddLine) {
    fail(errors, `${entry.relPath} must commit only approved generated output paths`);
  }
  for (const token of activeRootInstructionOutputs) {
    if (gitAddLines.some((line) => line.includes(token))) {
      fail(errors, `${entry.relPath} must not stage active root AI instruction files: ${token}`);
    }
  }
  if (/git(?:\s+-C\s+"\$PR_ROOT")?\s+add\b/.test(commitStep)) {
    fail(errors, `${entry.relPath} commit step must not run git add`);
  }
  const dangerousGitEnvUnset = 'unset GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_OBJECT_DIRECTORY GIT_SSH_COMMAND';
  const safePathExport = 'export PATH="/usr/bin:/bin"';
  if (!commitStep.includes(dangerousGitEnvUnset) || !commitStep.includes(safePathExport)) {
    fail(errors, `${entry.relPath} commit step must reset dangerous git environment state`);
  }
  if (!pushStep.includes(dangerousGitEnvUnset) || !pushStep.includes(safePathExport)) {
    fail(errors, `${entry.relPath} push step must reset dangerous git environment state`);
  }
  if (!/\/usr\/bin\/git\s+-C\s+"\$PR_ROOT"\s+commit\s+--no-verify\s+-m\s+"chore: sync generated toolkit surfaces"/.test(text)) {
    fail(errors, `${entry.relPath} must use git commit --no-verify`);
  }
  if (!text.includes('/usr/bin/git -C "$PR_ROOT" remote set-url origin "https://x-access-token:${GH_TOKEN}@github.com/${REPOSITORY_FULL_NAME}.git"') ||
      !text.includes('/usr/bin/git -C "$PR_ROOT" push origin "HEAD:${HEAD_REF}"')) {
    fail(errors, `${entry.relPath} must set push remote with the GitHub token only in the final push step`);
  }
  if (/\bgit\b[^\n]*\bpush\b[^\n]*(?:--force|-f\b)|(?:--force|-f\b)[^\n]*\bgit\b[^\n]*\bpush\b/.test(text)) {
    fail(errors, `${entry.relPath} must not force push generated output`);
  }
  const remoteCheckIndex = pushStep.indexOf('/usr/bin/git -C "$PR_ROOT" ls-remote origin "refs/heads/${HEAD_REF}"');
  const pushCommandIndex = pushStep.indexOf('/usr/bin/git -C "$PR_ROOT" push origin "HEAD:${HEAD_REF}"');
  if (remoteCheckIndex === -1 || pushCommandIndex === -1 || remoteCheckIndex > pushCommandIndex ||
      !pushStep.includes('"$remote_head_sha" != "$HEAD_SHA"') ||
      !pushStep.includes('PR branch moved after guarded checkout')) {
    fail(errors, `${entry.relPath} final push must verify the PR branch still points to HEAD_SHA before pushing`);
  }
}

function validateWorkflows(errors) {
  const workflowFiles = listFiles().filter((entry) => entry.relPath.startsWith('.github/workflows/') && /\.ya?ml$/i.test(entry.relPath));
  const scheduledSourceWatchWorkflows = [];
  for (const entry of workflowFiles) {
    const text = fs.readFileSync(entry.fullPath, 'utf8');
    const isAutoSyncGeneratedSurfacesWorkflow = entry.relPath === autoSyncGeneratedSurfacesWorkflowPath;
    const isSourceWatchPlanWorkflow = entry.relPath === '.github/workflows/source-watch-plan.yml';
    const isSourceWatchPrWorkflow = entry.relPath === sourceWatchPrWorkflowPath;
    const isReadOnlyValidationWorkflow = entry.relPath === '.github/workflows/validate.yml';
    if (!/^permissions:\s*$/m.test(text)) fail(errors, `${entry.relPath} missing explicit permissions block`);
    if (/contents:\s*write/i.test(text) && !isAutoSyncGeneratedSurfacesWorkflow && !isSourceWatchPrWorkflow) fail(errors, `${entry.relPath} uses contents: write`);
    if (/pull-requests:\s*write/i.test(text) && !isSourceWatchPrWorkflow) fail(errors, `${entry.relPath} uses pull-requests: write`);
    if (/gh\s+pr\s+merge/i.test(text) || (/auto-merge/i.test(text) && !/No auto-merge is allowed\./.test(text))) {
      fail(errors, `${entry.relPath} contains forbidden merge behavior`);
    }
    if (/git\s+commit|git\s+push/i.test(text) && !isAutoSyncGeneratedSurfacesWorkflow && !isSourceWatchPrWorkflow) fail(errors, `${entry.relPath} contains forbidden commit/push behavior`);
    if (isSourceWatchPlanWorkflow && !/^name:\s*Source Watch Advisory Plan\s*$/m.test(text)) {
      fail(errors, `${entry.relPath} workflow name must be advisory/read-only`);
    }
    if (isSourceWatchPlanWorkflow && /^\s{2}schedule:\s*$/m.test(text)) {
      fail(errors, `${entry.relPath} must stay manual-only; scheduled source-watch notifications belong in ${sourceWatchPrWorkflowPath}`);
    }
    if (isSourceWatchPrWorkflow) validateSourceWatchPrWorkflow(entry, text, errors);
    if (isAutoSyncGeneratedSurfacesWorkflow) validateAutoSyncGeneratedSurfacesWorkflow(entry, text, errors);
    if (isReadOnlyValidationWorkflow) validateReadOnlyValidationWorkflow(entry, text, errors);
    if (entry.relPath.endsWith('safe-source-update.yml')) {
      fail(errors, `${entry.relPath} has been retired; source update notifications must use PRs, not issues`);
    }
    if (/\bsource[- ]watch\b/i.test(`${entry.relPath}\n${text}`) && /^\s{2}schedule:\s*$/m.test(text)) {
      scheduledSourceWatchWorkflows.push(entry.relPath);
    }
  }
  if (scheduledSourceWatchWorkflows.length !== 1 || scheduledSourceWatchWorkflows[0] !== sourceWatchPrWorkflowPath) {
    fail(errors, `${sourceWatchPrWorkflowPath} must be the only scheduled source-watch workflow`);
  }
}

function validateSourceWatchPrWorkflow(entry, text, errors) {
  if (!/^name:\s*Source Watch PR Notifier\s*$/m.test(text)) {
    fail(errors, `${entry.relPath} workflow name must be Source Watch PR Notifier`);
  }
  for (const cron of ['17 3 * * *', '43 9 * * *', '29 15 * * *']) {
    if (!text.includes(`cron: "${cron}"`)) fail(errors, `${entry.relPath} missing staggered cron ${cron}`);
  }
  const permissions = workflowPermissionLines(text) || [];
  const expectedPermissions = ['contents: write', 'pull-requests: write'];
  if (permissions.length !== expectedPermissions.length || expectedPermissions.some((permission) => !permissions.includes(permission))) {
    fail(errors, `${entry.relPath} must grant only contents: write and pull-requests: write`);
  }
  if (!/repo\/scripts\/check-project-source-updates\.cjs/.test(text)) {
    fail(errors, `${entry.relPath} must run check-project-source-updates.cjs`);
  }
  if (!/persist-credentials:\s*false/.test(text)) {
    fail(errors, `${entry.relPath} checkout must set persist-credentials false`);
  }
  if (!/GH_TOKEN:\s*\$\{\{ github\.token \}\}/.test(text)) {
    fail(errors, `${entry.relPath} must scope GH_TOKEN to write/PR steps`);
  }
  if (!/git remote set-url origin "https:\/\/x-access-token:\$\{GH_TOKEN\}@github\.com\/\$\{GITHUB_REPOSITORY\}\.git"/.test(text)) {
    fail(errors, `${entry.relPath} must set authenticated remote immediately before push`);
  }
  if (/git\s+push[^\n]*(?:--force(?!-with-lease)|-f\b)/i.test(text)) {
    fail(errors, `${entry.relPath} must not force-push without a lease`);
  }
  if (/git\s+push[^\n]*(?:HEAD:)?main\b/i.test(text)) {
    fail(errors, `${entry.relPath} must not push to main`);
  }
  if (/git\s+add[^\n]*(?:_projects|SOURCE-LOCK\.json)/i.test(text)) {
    fail(errors, `${entry.relPath} must only stage the source-watch report, not source files or locks`);
  }
  if (/repo\/scripts\/safe-source-update\.cjs|gh\s+issue\s+create/i.test(text)) {
    fail(errors, `${entry.relPath} must not create source-watch issues`);
  }
  if (!/source-watch\/review-active-third-party-updates/.test(text)) {
    fail(errors, `${entry.relPath} must use the stable source-watch review branch`);
  }
  if (!/\[source-watch\] Review active third-party source updates/.test(text)) {
    fail(errors, `${entry.relPath} must use the stable source-watch review PR title`);
  }
  for (const required of [
    'This PR is a review notification only.',
    'No source files were updated.',
    'No SOURCE-LOCK pins were changed.',
    'No upstream code was executed.',
    'No auto-merge is allowed.'
  ]) {
    if (!text.includes(required)) fail(errors, `${entry.relPath} missing PR safety body text: ${required}`);
  }
  const bodyMarker = 'cat > "$PR_BODY" <<\'EOF\'';
  const markerMatch = text.match(new RegExp(`^([ \\t]*)${escapeRegExp(bodyMarker)}[ \\t]*$`, 'm'));
  const bodyMatch = text.match(new RegExp(`${escapeRegExp(bodyMarker)}\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*EOF`, 'm'));
  if (!markerMatch || !bodyMatch) {
    fail(errors, `${entry.relPath} must write the review PR body with a heredoc`);
  } else {
    const yamlBlockIndent = markerMatch[1];
    const bodyText = bodyMatch[1]
      .split(/\r?\n/)
      .map((line) => line.startsWith(yamlBlockIndent) ? line.slice(yamlBlockIndent.length) : line)
      .join('\n');
    if (/^ {4,}\S/m.test(bodyText)) {
      fail(errors, `${entry.relPath} PR body heredoc content must not render as an indented Markdown code block`);
    }
  }
}

function isIgnoredMarkdown(relPath) {
  const parts = relPath.split('/');
  return parts[0] === '_projects' && (parts.includes('_main') || parts.includes('curated_output_for_ai'));
}

function isExternalOrAnchorLink(target) {
  return (
    !target ||
    target.startsWith('#') ||
    target.startsWith('//') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)
  );
}

function cleanMarkdownTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
  if (isExternalOrAnchorLink(target)) return null;
  const whitespace = target.search(/\s/);
  if (whitespace !== -1) target = target.slice(0, whitespace);
  target = target.split('#')[0].split('?')[0];
  if (isExternalOrAnchorLink(target)) return null;
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep the original target when it is not URI-encoded.
  }
  return target;
}

function linkTargetRel(markdownRel, target) {
  const base = slash(path.posix.dirname(markdownRel));
  const rel = target.startsWith('/')
    ? slash(path.posix.normalize(target.replace(/^\/+/, '')))
    : slash(path.posix.normalize(path.posix.join(base, target)));
  return rel === '.' ? '' : rel;
}

function markdownLinkTargets(text) {
  const targets = [];
  const inline = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
  const reference = /^\s*\[[^\]\n]+\]:[ \t]+(\S+)/gm;
  for (const regex of [inline, reference]) {
    let match;
    while ((match = regex.exec(text)) !== null) targets.push(match[1]);
  }
  return targets;
}

function validateMarkdownLinks(errors) {
  const markdownFiles = listFiles().filter((entry) =>
    entry.relPath.toLowerCase().endsWith('.md') && !isIgnoredMarkdown(entry.relPath)
  );
  for (const entry of markdownFiles) {
    const text = fs.readFileSync(entry.fullPath, 'utf8').replace(/\r\n/g, '\n');
    for (const rawTarget of markdownLinkTargets(text)) {
      const target = cleanMarkdownTarget(rawTarget);
      if (!target) continue;
      const rel = linkTargetRel(entry.relPath, target);
      if (!rel || rel.startsWith('../') || rel === '..') {
        fail(errors, `${entry.relPath} links outside the repo: ${target}`);
        continue;
      }
      if (!existsRel(rel)) fail(errors, `${entry.relPath} links to missing path: ${rel}`);
    }
  }
}

function validateSourceWatchTruthfulness(errors) {
  for (const relPath of [
    '_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/source-of-truth-contract.md',
    'AGENTS.md',
    'README.md',
    '_projects/repo-methodology/context-preserving-ai-publisher/_main/templates/repo-docs/project-module-standard.template.md',
    'skills/context-preserving-ai-publisher/templates/repo-docs/project-module-standard.template.md'
  ]) {
    if (!existsRel(relPath) || !readText(relPath).includes(sourceWatchPrNotificationRule)) {
      fail(errors, `${relPath} missing source-watch PR-notification-only rule`);
    }
  }

  const workflowPath = '.github/workflows/source-watch-plan.yml';
  if (existsRel(workflowPath)) {
    const workflow = readText(workflowPath);
    if (!/^name:\s*Source Watch Advisory Plan\s*$/m.test(workflow)) {
      fail(errors, `${workflowPath} workflow name must be advisory/read-only`);
    }
    if (/^\s{2}schedule:\s*$/m.test(workflow)) {
      fail(errors, `${workflowPath} must stay manual-only; scheduled source-watch notifications belong in ${sourceWatchPrWorkflowPath}`);
    }
  }
  if (existsRel(sourceWatchPrWorkflowPath)) {
    const workflow = readText(sourceWatchPrWorkflowPath);
    if (!/^name:\s*Source Watch PR Notifier\s*$/m.test(workflow)) {
      fail(errors, `${sourceWatchPrWorkflowPath} workflow name must be Source Watch PR Notifier`);
    }
  }

  const sourceWatchFiles = listFiles().filter((entry) => {
    const rel = entry.relPath;
    if (rel === 'README.md' || rel === 'AGENTS.md') return true;
    if (rel.startsWith('.github/workflows/')) return true;
    if (rel.startsWith('repo/docs/')) return true;
    if (rel === 'repo/scripts/watch-project-sources.cjs') return true;
    if (rel === 'repo/scripts/check-project-source-updates.cjs') return true;
    if ((rel.startsWith('skills/') || rel.startsWith('mcp/')) && /\.(md|json|ya?ml)$/i.test(rel)) return true;
    return false;
  });
  const forbiddenClaims = [
    /\bsource[- ]watch\b[^\n.]{0,180}\b(clones?|pulls?)\b[^\n.]*(upstream|repos?|source files?)/i,
    /\bsource[- ]watch\b[^\n.]{0,180}\b(copies?|syncs?|applies?)\b[^\n.]*(files?|allowlisted|updates?)/i,
    /\bsource[- ]watch\b[^\n.]{0,180}\b(updates?|writes?|modifies?)\b[^\n.]*(SOURCE-LOCK|locks?)/i,
    /\bsource[- ]watch\b[^\n.]{0,180}\b(runs?|executes?)\b[^\n.]*(live n8n|n8n actions?|imports?|exports?)/i,
    /\bsource[- ]watch\b[^\n.]{0,180}\b(mutates?|changes?|updates?)\b[^\n.]*(credentials?|secrets?|live systems?)/i
  ];
  const negationPattern = /\b(does not|do not|must not|must never|never|will not|cannot|can't)\b/gi;
  const contrastAfterNegationPattern = /\b(but|however|though|although|except)\b/i;
  function isForbiddenActionNegated(line, matchIndex) {
    const clauseStart = Math.max(line.lastIndexOf('.', matchIndex), line.lastIndexOf(';', matchIndex), line.lastIndexOf(':', matchIndex)) + 1;
    const prefix = line.slice(clauseStart, matchIndex).toLowerCase();
    let lastNegationEnd = -1;
    let match;
    negationPattern.lastIndex = 0;
    while ((match = negationPattern.exec(prefix)) !== null) {
      lastNegationEnd = match.index + match[0].length;
    }
    if (lastNegationEnd === -1) return false;
    return !contrastAfterNegationPattern.test(prefix.slice(lastNegationEnd));
  }

  for (const entry of sourceWatchFiles) {
    const text = fs.readFileSync(entry.fullPath, 'utf8').replace(/\r\n/g, '\n');
    for (const line of text.split('\n')) {
      if (!/\bsource[- ]watch\b/i.test(line)) continue;
      const hasUnnegatedForbiddenClaim = forbiddenClaims.some((pattern) => {
        const match = pattern.exec(line);
        if (!match) return false;
        const actionIndex = line.toLowerCase().indexOf(match[1].toLowerCase(), match.index);
        return !isForbiddenActionNegated(line, actionIndex === -1 ? match.index : actionIndex);
      });
      if (hasUnnegatedForbiddenClaim) {
        fail(errors, `${entry.relPath} source-watch wording must stay notification-only and source-safe`);
        break;
      }
    }
  }
}

function validateMcpDocs(errors) {
  for (const entry of listFiles().filter((item) => item.relPath.startsWith('mcp/'))) {
    const text = fs.readFileSync(entry.fullPath, 'utf8');
    if (/tool\s*:\s*(shell|write|exec)|execute_shell|write_file|read_any_file/i.test(text)) {
      fail(errors, `${entry.relPath} appears to define arbitrary MCP shell/write/read tools`);
    }
  }
}

function runValidation() {
  const errors = [];
  assertExpectedFiles(errors);
  validateRootTopology(errors);
  validateForbiddenFiles(errors);
  validateTrackedLocalRuntimeFiles(errors);
  validateJsonRegistries(errors);
  validateSourceRepoRegistry(errors);
  validatePacks(errors);
  validateSkills(errors);
  validateExecutables(errors);
  validateDesignGeneratorLocalOnly(errors);
  validateDocContract(errors);
  validateAgentInstructionShims(errors);
  validateReadmeSurface(errors);
  validateProjectModules(errors);
  validateProjectLandingCards(errors);
  validateSourceLocks(errors);
  validateSkillPortability(errors);
  validateAgentRuleSources(errors);
  validateNoActiveAgentInstructionFilesInSkills(errors);
  validateNoOldForAiReferences(errors);
  validateStaleReferences(errors);
  validateSecretStrings(errors);
  validateWorkflows(errors);
  validateMarkdownLinks(errors);
  validateSourceWatchTruthfulness(errors);
  validateMcpDocs(errors);
  return errors;
}

if (require.main === module) {
  const errors = runValidation();
  if (errors.length) {
    for (const error of errors) console.error(`FAIL: ${error}`);
    console.error(`\nSummary: ${errors.length} validation error(s).`);
    process.exit(1);
  }
  console.log('Toolkit validation passed.');
}

module.exports = {
  isAutoSyncGeneratedOutputPath,
  parseFrontMatter,
  projectManifests,
  runValidation,
  skillDirs,
  validateForbiddenFiles,
  validateDesignGeneratorLocalOnly,
  validateMarkdownLinks,
  validateStaleReferences,
  validateSecretStrings
};
