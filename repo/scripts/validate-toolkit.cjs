#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const docContractSync = require('./sync-repo-doc-contract.cjs');
const sourceLockAudit = require('./audit-project-source-locks.cjs');
const projectSync = require('./sync-toolkit-projects.cjs');

const root = process.cwd();
const registryYamlText = 'reg' + 'istry/*.' + 'yaml';
const packYamlText = 'pack.' + 'yaml';

const expectedFiles = [
  'README.md',
  'AGENTS.md',
  'package.json',
  '.gitignore',
  '.gitattributes',
  'for_ai/README.md',
  'repo/docs/HOW-TO-USE.md',
  'repo/docs/partials/source-of-truth-contract.md',
  'repo/docs/FOR_AI_AGENTS.md',
  'repo/docs/SAFE-UPDATES.md',
  'repo/docs/SOURCE-OF-TRUTH.md',
  'repo/docs/RETIRED-SOURCE-PROVENANCE.md',
  'repo/docs/CLEANUP-POLICY.md',
  'repo/docs/THIRD-PARTY-SOURCE-NOTES.md',
  'repo/docs/PROJECT-MODULE-STANDARD.md',
  'repo/docs/WRITE-SAFETY-MODEL.md',
  'repo/docs/PROJECT-REHAUL-CHECKLIST.md',
  'for_ai/tools/design-system-generator/README.md',
  'for_ai/tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md',
  'for_ai/tools/design-system-generator/scripts/core.py',
  'for_ai/tools/design-system-generator/scripts/design_system.py',
  'for_ai/tools/design-system-generator/data/app-interface.csv',
  'for_ai/tools/design-system-generator/data/charts.csv',
  'for_ai/tools/design-system-generator/data/products.csv',
  'for_ai/tools/design-system-generator/data/styles.csv',
  'for_ai/tools/design-system-generator/data/colors.csv',
  'for_ai/tools/design-system-generator/data/google-fonts.csv',
  'for_ai/tools/design-system-generator/data/icons.csv',
  'for_ai/tools/design-system-generator/data/landing.csv',
  'for_ai/tools/design-system-generator/data/react-performance.csv',
  'for_ai/tools/design-system-generator/data/typography.csv',
  'for_ai/tools/design-system-generator/data/ui-reasoning.csv',
  'for_ai/tools/design-system-generator/data/ux-guidelines.csv',
  'for_ai/tools/design-system-generator/data/stacks/react.csv',
  'for_ai/tools/design-system-generator/data/stacks/nextjs.csv',
  'for_ai/tools/design-system-generator/data/stacks/vue.csv',
  'for_ai/tools/design-system-generator/data/stacks/svelte.csv',
  'for_ai/tools/design-system-generator/data/stacks/astro.csv',
  'for_ai/tools/design-system-generator/data/stacks/swiftui.csv',
  'for_ai/tools/design-system-generator/data/stacks/react-native.csv',
  'for_ai/tools/design-system-generator/data/stacks/flutter.csv',
  'for_ai/tools/design-system-generator/data/stacks/nuxtjs.csv',
  'for_ai/tools/design-system-generator/data/stacks/nuxt-ui.csv',
  'for_ai/tools/design-system-generator/data/stacks/html-tailwind.csv',
  'for_ai/tools/design-system-generator/data/stacks/shadcn.csv',
  'for_ai/tools/design-system-generator/data/stacks/jetpack-compose.csv',
  'for_ai/tools/design-system-generator/data/stacks/threejs.csv',
  'for_ai/tools/design-system-generator/data/stacks/angular.csv',
  'for_ai/tools/design-system-generator/data/stacks/laravel.csv',
  'for_ai/tools/design-system-generator/tests/test_local_only.py',
  'for_ai/registry/skills.registry.json',
  'for_ai/registry/playbooks.registry.json',
  'for_ai/registry/templates.registry.json',
  'for_ai/registry/packs.registry.json',
  'for_ai/registry/projects.registry.json',
  'for_ai/registry/tools.registry.json',
  'for_ai/registry/source-repos.registry.json',
  'for_ai/registry/consumers.registry.json',
  '_projects/n8n/local-setup/SOURCE-LOCK.json',
  '_projects/n8n/workflow-templates/SOURCE-LOCK.json',
  '_projects/cicd/secure-installer/SOURCE-LOCK.json',
  '_projects/design/ui-ux-pro-max/SOURCE-LOCK.json',
  'for_ai/templates/agent-rules/partials/skill-routing-rules.md',
  'repo/scripts/build-agent-rule-templates.ps1',
  'repo/scripts/- build-agent-rule-templates.cmd',
  'repo/scripts/validate-toolkit.cjs',
  'repo/scripts/sync-toolkit-projects.cjs',
  'repo/scripts/audit-project-source-locks.cjs',
  'repo/scripts/watch-project-sources.cjs',
  'repo/scripts/package-skills.cjs',
  'repo/scripts/package-packs.cjs',
  'repo/scripts/safe-source-update.cjs',
  'repo/scripts/sync-repo-doc-contract.cjs',
  '.github/workflows/auto-sync-generated-surfaces.yml',
  '.github/workflows/source-watch-plan.yml',
  '.github/workflows/validate.yml'
];

const expectedDirs = [
  '_projects',
  '_projects/n8n/local-setup',
  '_projects/n8n/local-setup/_main',
  '_projects/n8n/workflow-templates',
  '_projects/n8n/workflow-templates/_main',
  '_projects/cicd/secure-installer',
  '_projects/cicd/secure-installer/_main',
  '_projects/design/ui-ux-pro-max',
  '_projects/design/ui-ux-pro-max/_main',
  'for_ai/skills/design/ui-ux-secure-frontend-design',
  'for_ai/skills/development/windows-localhost-workflows',
  'for_ai/skills/automation/n8n-workflow-sync',
  'for_ai/skills/automation/n8n-local-setup',
  'for_ai/skills/cicd/secure-cicd-installer',
  'for_ai/playbooks/ai-agent-platforms',
  'for_ai/playbooks/mcp',
  'for_ai/playbooks/n8n',
  'for_ai/playbooks/cicd',
  'for_ai/playbooks/design',
  'for_ai/templates/agent-rules',
  'for_ai/templates/agent-rules/partials',
  'for_ai/templates/mcp-configs',
  'for_ai/templates/n8n/sync-helpers',
  'for_ai/templates/n8n/sanitizer',
  'for_ai/templates/n8n/workflow-policy',
  'for_ai/tools/design-system-generator',
  'for_ai/tools/design-system-generator/scripts',
  'for_ai/tools/design-system-generator/data',
  'for_ai/tools/design-system-generator/data/stacks',
  'for_ai/tools/design-system-generator/tests',
  'for_ai/packs/frontend-design-skill',
  'for_ai/packs/design-system-generator',
  'for_ai/packs/codex-n8n-local',
  'for_ai/packs/claude-code-n8n-local',
  'for_ai/packs/secure-cicd',
  'for_ai/packs/n8n-workflow-sync',
  'for_ai/mcp/registry-mcp',
  'for_ai/mcp/installer-mcp',
  'for_ai/mcp/projects',
  'repo/docs/partials',
  '.github/workflows'
];

const registryFiles = [
  'for_ai/registry/skills.registry.json',
  'for_ai/registry/playbooks.registry.json',
  'for_ai/registry/templates.registry.json',
  'for_ai/registry/packs.registry.json',
  'for_ai/registry/projects.registry.json',
  'for_ai/registry/tools.registry.json',
  'for_ai/registry/source-repos.registry.json',
  'for_ai/registry/consumers.registry.json'
];

const retiredInternalSourceRepos = new Set([
  'weijunswj/codex-n8n-local-setup',
  'weijunswj/ai-cicd-installer',
  'weijunswj/n8n-workflow-templates'
]);

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
  'AGENTS.md',
  'README.md',
  '_projects',
  'for_ai',
  'package.json',
  'repo'
]);

const staleReferenceRoots = [
  'README.md',
  'AGENTS.md',
  'package.json',
  '.github',
  'repo',
  'for_ai'
];

const staleRootSurfacePatterns = [
  { label: 'root skills surface', regex: /(^|[\s`"'(\[,:])skills\//m },
  { label: 'root MCP surface', regex: /(^|[\s`"'(\[,:])mcp\//m },
  { label: 'root templates surface', regex: /(^|[\s`"'(\[,:])templates\//m },
  { label: 'root packs surface', regex: /(^|[\s`"'(\[,:])packs\//m },
  { label: 'root registry surface', regex: /(^|[\s`"'(\[,:])registry\//m },
  { label: 'root tools surface', regex: /(^|[\s`"'(\[,:])tools\//m },
  { label: 'root guides surface', regex: /(^|[\s`"'(\[,:])guides\//m },
  { label: 'root docs surface', regex: /(^|[\s`"'(\[,:])docs\//m },
  { label: 'root scripts surface', regex: /(^|[\s`"'(\[,:])scripts\//m },
  { label: 'root tests surface', regex: /(^|[\s`"'(\[,:])tests\//m }
];

const staleProjectExportsPath = /\bprojects\/[^ \n`"')]+\/exports\//;

const allowedExecutablePrefixes = [
  'repo/scripts/',
  'repo/tests/',
  '.github/workflows/',
  'for_ai/tools/design-system-generator/scripts/',
  'for_ai/tools/design-system-generator/tests/',
  'for_ai/templates/n8n/sync-helpers/',
  'for_ai/templates/n8n/sanitizer/'
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

function isIgnoredWalkDir(name) {
  return name === '.git' || name === '__pycache__';
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

function isAutoSyncGeneratedOutputPath(relPath) {
  const rel = slash(relPath);
  return (
    rel === 'README.md' ||
    rel === 'AGENTS.md' ||
    rel === 'for_ai/README.md' ||
    rel.startsWith('for_ai/')
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
      if (['.n8n-local', '.tmp', '.to-sanitise', '.sanitised', '.n8n-workflow-backups', '_dist', 'dist', 'node_modules', 'coverage'].includes(name)) {
        fail(errors, `Forbidden directory present: ${rel}`);
      }
      continue;
    }

    if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) fail(errors, `Forbidden env file: ${rel}`);
    if (lower.endsWith('.zip') || lower.endsWith('.tgz')) fail(errors, `Generated package artifact present: ${rel}`);
    if (lower.endsWith('.live-export.json') || lower.endsWith('.live-import.json')) fail(errors, `Live n8n import/export file present: ${rel}`);
    const safeExampleJson = lower.endsWith('.example.json') || lower.endsWith('-example.json');
    if (!safeExampleJson && (lower.endsWith('.credentials.json') || lower.endsWith('.credential.json') || lower.endsWith('.credential.json'))) fail(errors, `Credential file present: ${rel}`);
    if (!safeExampleJson && /credential.*\.json$/i.test(name) && !lower.endsWith('package.json')) fail(errors, `Credential-looking JSON file present: ${rel}`);
    if (/binding.*\.json$/i.test(name)) fail(errors, `Credential binding-looking JSON file present: ${rel}`);
    if (['.pem', '.key', '.p12', '.pfx'].some((ext) => lower.endsWith(ext))) fail(errors, `Private key/certificate file present: ${rel}`);
    if (name === 'id_rsa' || name === 'id_ed25519') fail(errors, `Private SSH key present: ${rel}`);
    if (name.toLowerCase() === packYamlText) fail(errors, `${packYamlText} is not allowed: ${rel}`);
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
    entry.relPath.startsWith('for_ai/registry/') && /\.(ya?ml)$/i.test(entry.relPath)
  );
  for (const entry of yamlRegistries) fail(errors, `YAML registry file is not allowed: ${entry.relPath}`);
}

function validateRootTopology(errors) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!allowedRootEntries.has(entry.name)) {
      fail(errors, `Unexpected root entry: ${entry.name}`);
    }
  }
}

function validateSourceRepoRegistry(errors) {
  let registry;
  try {
    registry = readJson('for_ai/registry/source-repos.registry.json');
  } catch (error) {
    fail(errors, `for_ai/registry/source-repos.registry.json is not valid JSON: ${error.message}`);
    return;
  }
  if (!Array.isArray(registry)) {
    fail(errors, 'for_ai/registry/source-repos.registry.json must be an array');
    return;
  }

  for (const entry of registry) {
    if (retiredInternalSourceRepos.has(entry.source)) {
      fail(errors, `for_ai/registry/source-repos.registry.json retired internal repo must not be listed as active source-watch target: ${entry.source}`);
    }
    const thirdParty = activeThirdPartySources.get(entry.source);
    if (!thirdParty) continue;
    if (entry.risk !== thirdParty.risk) {
      fail(errors, `for_ai/registry/source-repos.registry.json active third-party source missing risk metadata: ${entry.source}`);
    }
    if (entry.review_policy !== thirdParty.review_policy) {
      fail(errors, `for_ai/registry/source-repos.registry.json active third-party source missing manual-review metadata: ${entry.source}`);
    }
    if (!thirdParty.requiredStatus.test(entry.status || '')) {
      fail(errors, `for_ai/registry/source-repos.registry.json active third-party source missing attribution status: ${entry.source}`);
    }
    if (!thirdParty.requiredRole.test(entry.role || '')) {
      fail(errors, `for_ai/registry/source-repos.registry.json active third-party source missing attribution role: ${entry.source}`);
    }
    if (!entry.last_reviewed) {
      fail(errors, `for_ai/registry/source-repos.registry.json active third-party source missing last_reviewed: ${entry.source}`);
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
  const skillsRoot = resolveRel('for_ai/skills');
  if (!fs.existsSync(skillsRoot)) return result;
  for (const category of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const categoryDir = path.join(skillsRoot, category.name);
    for (const skill of fs.readdirSync(categoryDir, { withFileTypes: true })) {
      if (skill.isDirectory()) result.push(slash(path.relative(root, path.join(categoryDir, skill.name))));
    }
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

  const designSkill = 'for_ai/skills/design/ui-ux-secure-frontend-design/SKILL.md';
  const expectedDescription = 'Security-first frontend UI/UX design skill for creating, reviewing, and improving web interfaces. Use for design systems, landing pages, SaaS dashboards, forms, component planning, accessibility, responsive polish, privacy-safe UX, and implementation review.';
  const designMatter = parseFrontMatter(readText(designSkill));
  if (designMatter?.name !== 'ui-ux-secure-frontend-design') fail(errors, 'Design skill front matter name is not approved');
  if (designMatter?.description !== expectedDescription) fail(errors, 'Design skill front matter description is not approved');

  const openai = readText('for_ai/skills/design/ui-ux-secure-frontend-design/agents/openai.yaml').trim() + '\n';
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

  for (const entry of listFiles().filter((item) => item.relPath.startsWith('for_ai/skills/design/ui-ux-secure-frontend-design/') && item.relPath.endsWith('.md'))) {
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
        rel.startsWith('for_ai/tools/design-system-generator/scripts/') ||
        rel.startsWith('for_ai/tools/design-system-generator/tests/') ||
        rel.startsWith('repo/tests/');
      if (!allowedPython) fail(errors, `Python file outside approved locations: ${rel}`);
    }
    const allowed = allowedExecutablePrefixes.some((prefix) => rel.startsWith(prefix));
    if (!allowed) fail(errors, `Executable file outside approved locations: ${rel}`);
    if (rel.startsWith('for_ai/skills/')) fail(errors, `Instruction-only skill contains executable file: ${rel}`);
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
    if (!existsRel(`for_ai/tools/design-system-generator/data/${file}`)) fail(errors, `Missing design generator data file: ${file}`);
  }
  for (const file of requiredStacks) {
    if (!existsRel(`for_ai/tools/design-system-generator/data/stacks/${file}`)) fail(errors, `Missing design generator stack data file: ${file}`);
  }

  const scriptFiles = listFiles().filter((entry) =>
    entry.relPath.startsWith('for_ai/tools/design-system-generator/scripts/') && entry.relPath.endsWith('.py')
  );

  for (const entry of scriptFiles) {
    const text = fs.readFileSync(entry.fullPath, 'utf8').toLowerCase();
    for (const token of designGeneratorForbiddenTokens) {
      if (text.includes(token)) {
        fail(errors, `Design generator script contains forbidden local-only token "${token}": ${entry.relPath}`);
      }
    }
  }

  const licenseNotes = readText('for_ai/tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md');
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
      /for_ai\/playbooks\/?[^\n.]{0,140}\b(canonical|source[- ]of[- ]truth|human documentation|human docs|source layer)\b/i.test(text) ||
      /\b(canonical|source[- ]of[- ]truth|human documentation|human docs|source layer)\b[^\n.]{0,140}for_ai\/playbooks\/?/i.test(text);
    if (playbooksCanonical) {
      fail(errors, `${entry.relPath} must not claim for_ai/playbooks/ is canonical human documentation`);
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

function validateAgentRuleSources(errors) {
  const linkedOutputs = new Set();
  for (const manifest of projectManifests()) {
    for (const output of manifest.outputs || []) {
      if (output.kind === 'linked') linkedOutputs.add(output.output);
    }
  }
  const rootPartialFiles = listFiles().filter((entry) => entry.relPath.startsWith('for_ai/templates/agent-rules/partials/'));
  for (const entry of rootPartialFiles) {
    if (!linkedOutputs.has(entry.relPath)) fail(errors, `Root agent-rule partial is an unmanaged duplicate: ${entry.relPath}`);
  }
}

function validateStaleReferences(errors) {
  const roots = new Set(staleReferenceRoots);
  for (const entry of listFiles()) {
    if (entry.relPath.includes('/_main/')) continue;
    if (/^for_ai\/templates\/n8n\/(sync-helpers|sanitizer)\/.*\.(cjs|js|ps1|cmd)$/.test(entry.relPath)) continue;
    if (entry.relPath.startsWith('for_ai/tools/design-system-generator/data/')) continue;
    if (entry.relPath.startsWith('for_ai/tools/design-system-generator/scripts/')) continue;
    const top = entry.relPath.split('/')[0];
    if (!roots.has(top) && !roots.has(entry.relPath)) continue;
    const text = fs.readFileSync(entry.fullPath, 'utf8');
    if (text.includes(registryYamlText) || text.includes('for_ai/registry/*.' + 'yaml') || text.includes('for_ai/registry/skills.' + 'yaml') || text.includes('for_ai/registry/guides.' + 'yaml')) {
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
    const match = line.match(/^  ([A-Za-z-]+):\s*(\S+)\s*$/);
    if (match) permissions.push(`${match[1]}: ${match[2]}`);
  }
  return permissions;
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

  if (/repo\/scripts\/(?:watch-project-sources|safe-source-update)\.cjs/i.test(text)) {
    fail(errors, `${entry.relPath} must not run source-watch or source-update scripts`);
  }
  if (/\bn8n\s+(?:import|export)\b|(?:import|export)-n8n-workflows-live|docker\s+exec[^\n]*\bn8n\b/i.test(text)) {
    fail(errors, `${entry.relPath} must not run live n8n import/export`);
  }

  const preflightIndex = text.indexOf('- name: Preflight guard');
  const checkoutIndex = text.indexOf('uses: actions/checkout@v4');
  if (preflightIndex === -1 || checkoutIndex === -1 || checkoutIndex < preflightIndex) {
    fail(errors, `${entry.relPath} must run preflight before checking out the PR branch`);
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
  const steps = workflowStepBlocks(text);
  for (const step of steps) {
    const hasToken = step.text.includes('${{ github.token }}');
    if (hasToken && !['Preflight guard', 'Push generated surfaces'].includes(step.name)) {
      fail(errors, `${entry.relPath} must expose github.token only to preflight and final push steps`);
    }
  }
  if (/\bnpm\s+run\s+validate:all\b/.test(text)) {
    fail(errors, `${entry.relPath} must not run npm run validate:all in the privileged writeback workflow`);
  }
  if (/^\s*(?:npm|pnpm|yarn)(?:\.cmd)?(?:\s|$)/m.test(text)) {
    fail(errors, `${entry.relPath} must not run npm, pnpm, or yarn in the privileged writeback workflow`);
  }
  if (/\bnode\s+--test\b/.test(text)) {
    fail(errors, `${entry.relPath} must not run generated Node test suites in the privileged writeback workflow`);
  }
  if (/\bpython(?:3)?\s+-m\s+unittest\b|\bpytest\b/.test(text)) {
    fail(errors, `${entry.relPath} must not run Python unit tests in the privileged writeback workflow`);
  }
  if (/for_ai\/tools\/[^\n]*tests|design-system-generator\/tests/.test(text)) {
    fail(errors, `${entry.relPath} must not run generated tool tests in the privileged writeback workflow`);
  }

  const preflightSection = preflightIndex === -1 || checkoutIndex === -1
    ? ''
    : text.slice(preflightIndex, checkoutIndex);
  const requiredPreflightPathBlocks = [
    { label: '.github', token: '.github/*' },
    { label: 'repo/scripts', token: 'repo/scripts/*' },
    { label: 'repo/tests', token: 'repo/tests/*' },
    { label: '_projects/**/_main', token: '_projects/*/_main/*' },
    { label: 'package/lockfile changes', token: 'package.json|package-lock.json|pnpm-lock.yaml|yarn.lock' }
  ];
  for (const { label, token } of requiredPreflightPathBlocks) {
    if (!preflightSection.includes(token)) fail(errors, `${entry.relPath} missing forbidden preflight path rejection for ${label}`);
  }

  if (!text.includes('Forbidden post-sync change outside generated output scope') ||
      !/git\s+diff\s+--name-only/.test(text) ||
      !/git\s+diff\s+--name-only\s+--cached/.test(text) ||
      !/git\s+ls-files\s+--others\s+--exclude-standard/.test(text)) {
    fail(errors, `${entry.relPath} missing post-sync changed-path validation`);
  }
  if (!text.includes('_projects/*|repo/*|.github/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)')) {
    fail(errors, `${entry.relPath} missing forbidden post-sync path rejection`);
  }
  if (!text.includes('README.md|AGENTS.md|for_ai/*)')) {
    fail(errors, `${entry.relPath} missing approved generated output path allowlist`);
  }

  const postSyncStep = workflowStepText(steps, 'Guard, stage, and snapshot generated write scope');
  const staticChecksStep = workflowStepText(steps, 'Static generated surface checks');
  const finalRecheckStep = workflowStepText(steps, 'Final pre-commit workspace recheck');
  const commitStep = workflowStepText(steps, 'Commit generated surfaces');
  const pushStep = workflowStepText(steps, 'Push generated surfaces');

  if (!postSyncStep || !postSyncStep.includes('expected_index_tree="$(git write-tree)"') || !postSyncStep.includes('expected_index_tree=${expected_index_tree}')) {
    fail(errors, `${entry.relPath} must snapshot the staged index after the post-sync guard`);
  }
  const staticChecksIndex = text.indexOf('- name: Static generated surface checks');
  const finalRecheckIndex = text.indexOf('- name: Final pre-commit workspace recheck');
  const commitIndex = text.indexOf('- name: Commit generated surfaces');
  if (staticChecksIndex === -1 || finalRecheckIndex === -1 || commitIndex === -1 ||
      !(staticChecksIndex < finalRecheckIndex && finalRecheckIndex < commitIndex)) {
    fail(errors, `${entry.relPath} must recheck the workspace and staged index after validation and before commit`);
  }
  if (!finalRecheckStep.includes('git ls-files --others --exclude-standard')) {
    fail(errors, `${entry.relPath} final recheck must reject untracked files before commit`);
  }
  if (!finalRecheckStep.includes('git diff --quiet')) {
    fail(errors, `${entry.relPath} final recheck must reject unstaged tracked changes before commit`);
  }
  if (!finalRecheckStep.includes('current_index_tree="$(git write-tree)"') ||
      !finalRecheckStep.includes('Staged generated output changed after the post-sync guard') ||
      !finalRecheckStep.includes('"$current_index_tree" != "${EXPECTED_INDEX_TREE}"')) {
    fail(errors, `${entry.relPath} final recheck must compare the staged index tree snapshot`);
  }
  if (!finalRecheckStep.includes('git diff --cached --name-only') ||
      !finalRecheckStep.includes('README.md|AGENTS.md|for_ai/*)') ||
      !finalRecheckStep.includes('_projects/*|repo/*|.github/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)')) {
    fail(errors, `${entry.relPath} final recheck must reject staged paths outside generated output scope`);
  }
  if (!staticChecksStep.includes('node repo/scripts/sync-repo-doc-contract.cjs --check') ||
      !staticChecksStep.includes('node repo/scripts/sync-toolkit-projects.cjs --check') ||
      !staticChecksStep.includes('node repo/scripts/validate-toolkit.cjs') ||
      !staticChecksStep.includes('git diff --cached --check') ||
      !staticChecksStep.includes('git diff --check')) {
    fail(errors, `${entry.relPath} must run only protected static generated-surface checks before commit`);
  }

  const gitAddLines = (text.match(/^\s*git add .+$/gm) || []).map((line) => line.trim());
  if (gitAddLines.length !== 1 || gitAddLines[0] !== 'git add README.md AGENTS.md for_ai') {
    fail(errors, `${entry.relPath} must commit only approved generated output paths`);
  }
  if (commitStep.includes('git add ')) {
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
  if (!/\/usr\/bin\/git\s+commit\s+--no-verify\s+-m\s+"chore: sync generated toolkit surfaces"/.test(text)) {
    fail(errors, `${entry.relPath} must use git commit --no-verify`);
  }
  if (!text.includes('/usr/bin/git remote set-url origin "https://x-access-token:${GH_TOKEN}@github.com/${REPOSITORY_FULL_NAME}.git"') ||
      !text.includes('/usr/bin/git push origin "HEAD:${HEAD_REF}"')) {
    fail(errors, `${entry.relPath} must set push remote with the GitHub token only in the final push step`);
  }
}

function validateWorkflows(errors) {
  const workflowFiles = listFiles().filter((entry) => entry.relPath.startsWith('.github/workflows/') && /\.ya?ml$/i.test(entry.relPath));
  for (const entry of workflowFiles) {
    const text = fs.readFileSync(entry.fullPath, 'utf8');
    const isAutoSyncGeneratedSurfacesWorkflow = entry.relPath === autoSyncGeneratedSurfacesWorkflowPath;
    const isSourceWatchWorkflow = entry.relPath.endsWith('source-watch-plan.yml');
    if (!/^permissions:\s*$/m.test(text)) fail(errors, `${entry.relPath} missing explicit permissions block`);
    if (/contents:\s*write/i.test(text) && !isAutoSyncGeneratedSurfacesWorkflow) fail(errors, `${entry.relPath} uses contents: write`);
    if (/pull-requests:\s*write/i.test(text)) fail(errors, `${entry.relPath} uses pull-requests: write`);
    if (/auto-merge|gh\s+pr\s+merge/i.test(text)) fail(errors, `${entry.relPath} contains forbidden merge behavior`);
    if (/git\s+commit|git\s+push/i.test(text) && !isAutoSyncGeneratedSurfacesWorkflow) fail(errors, `${entry.relPath} contains forbidden commit/push behavior`);
    if (isSourceWatchWorkflow && !/^name:\s*Source Watch Advisory Plan\s*$/m.test(text)) {
      fail(errors, `${entry.relPath} workflow name must be advisory/read-only`);
    }
    if (isAutoSyncGeneratedSurfacesWorkflow) validateAutoSyncGeneratedSurfacesWorkflow(entry, text, errors);
    if (entry.relPath.endsWith('safe-source-update.yml') && !/issues:\s*write/i.test(text)) {
      fail(errors, `${entry.relPath} should use issues: write for issue summaries`);
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
  const workflowPath = '.github/workflows/source-watch-plan.yml';
  if (existsRel(workflowPath)) {
    const workflow = readText(workflowPath);
    if (!/^name:\s*Source Watch Advisory Plan\s*$/m.test(workflow)) {
      fail(errors, `${workflowPath} workflow name must be advisory/read-only`);
    }
  }

  const sourceWatchFiles = listFiles().filter((entry) => {
    const rel = entry.relPath;
    if (rel === 'README.md' || rel === 'AGENTS.md') return true;
    if (rel.startsWith('.github/workflows/')) return true;
    if (rel.startsWith('repo/docs/')) return true;
    if (rel === 'repo/scripts/watch-project-sources.cjs') return true;
    if (rel.startsWith('for_ai/') && /\.(md|json|ya?ml)$/i.test(rel)) return true;
    return false;
  });
  const forbiddenClaims = [
    /\bsource[- ]watch\b[^\n.]{0,180}\b(fetches?|clones?|pulls?)\b[^\n.]*(upstream|repos?|commits?)/i,
    /\bsource[- ]watch\b[^\n.]{0,180}\b(copies?|syncs?|applies?)\b[^\n.]*(files?|allowlisted|updates?)/i,
    /\bsource[- ]watch\b[^\n.]{0,180}\b(updates?|writes?|modifies?)\b[^\n.]*(SOURCE-LOCK|locks?)/i,
    /\bsource[- ]watch\b[^\n.]{0,180}\b(creates?|opens?|pushes?)\b[^\n.]*(branches?|PRs?|pull requests?|draft PRs?|commits?)/i,
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
        fail(errors, `${entry.relPath} source-watch wording must stay advisory/read-only`);
        break;
      }
    }
  }
}

function validateMcpDocs(errors) {
  for (const entry of listFiles().filter((item) => item.relPath.startsWith('for_ai/mcp/'))) {
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
  validateJsonRegistries(errors);
  validateSourceRepoRegistry(errors);
  validatePacks(errors);
  validateSkills(errors);
  validateExecutables(errors);
  validateDesignGeneratorLocalOnly(errors);
  validateDocContract(errors);
  validateProjectModules(errors);
  validateProjectLandingCards(errors);
  validateSourceLocks(errors);
  validateAgentRuleSources(errors);
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
