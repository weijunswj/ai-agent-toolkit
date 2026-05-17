#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sourceLockAudit = require('./audit-project-source-locks.cjs');
const projectSync = require('./sync-toolkit-projects.cjs');

const root = process.cwd();
const registryYamlText = 'registry/*.' + 'yaml';
const packYamlText = 'pack.' + 'yaml';

const expectedFiles = [
  'README.md',
  'AGENTS.md',
  'MIGRATION_CHECKLIST.md',
  'package.json',
  '.gitignore',
  '.gitattributes',
  'docs/HOW-TO-USE.md',
  'docs/FOR_AI_AGENTS.md',
  'docs/SAFE-UPDATES.md',
  'docs/SOURCE-OF-TRUTH.md',
  'docs/MIGRATION-SOURCES.md',
  'docs/CLEANUP-POLICY.md',
  'docs/THIRD-PARTY-SOURCE-NOTES.md',
  'docs/PROJECT-MODULE-STANDARD.md',
  'docs/WRITE-SAFETY-MODEL.md',
  'docs/PROJECT-REHAUL-CHECKLIST.md',
  'tools/design-system-generator/README.md',
  'tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md',
  'tools/design-system-generator/scripts/core.py',
  'tools/design-system-generator/scripts/design_system.py',
  'tools/design-system-generator/data/app-interface.csv',
  'tools/design-system-generator/data/charts.csv',
  'tools/design-system-generator/data/products.csv',
  'tools/design-system-generator/data/styles.csv',
  'tools/design-system-generator/data/colors.csv',
  'tools/design-system-generator/data/google-fonts.csv',
  'tools/design-system-generator/data/icons.csv',
  'tools/design-system-generator/data/landing.csv',
  'tools/design-system-generator/data/react-performance.csv',
  'tools/design-system-generator/data/typography.csv',
  'tools/design-system-generator/data/ui-reasoning.csv',
  'tools/design-system-generator/data/ux-guidelines.csv',
  'tools/design-system-generator/data/stacks/react.csv',
  'tools/design-system-generator/data/stacks/nextjs.csv',
  'tools/design-system-generator/data/stacks/vue.csv',
  'tools/design-system-generator/data/stacks/svelte.csv',
  'tools/design-system-generator/data/stacks/astro.csv',
  'tools/design-system-generator/data/stacks/swiftui.csv',
  'tools/design-system-generator/data/stacks/react-native.csv',
  'tools/design-system-generator/data/stacks/flutter.csv',
  'tools/design-system-generator/data/stacks/nuxtjs.csv',
  'tools/design-system-generator/data/stacks/nuxt-ui.csv',
  'tools/design-system-generator/data/stacks/html-tailwind.csv',
  'tools/design-system-generator/data/stacks/shadcn.csv',
  'tools/design-system-generator/data/stacks/jetpack-compose.csv',
  'tools/design-system-generator/data/stacks/threejs.csv',
  'tools/design-system-generator/data/stacks/angular.csv',
  'tools/design-system-generator/data/stacks/laravel.csv',
  'tools/design-system-generator/tests/test_local_only.py',
  'registry/skills.registry.json',
  'registry/guides.registry.json',
  'registry/templates.registry.json',
  'registry/packs.registry.json',
  'registry/projects.registry.json',
  'registry/tools.registry.json',
  'registry/source-repos.registry.json',
  'registry/consumers.registry.json',
  '_projects/n8n/local-setup/SOURCE-LOCK.json',
  '_projects/n8n/workflow-templates/SOURCE-LOCK.json',
  '_projects/cicd/secure-installer/SOURCE-LOCK.json',
  '_projects/design/ui-ux-pro-max/SOURCE-LOCK.json',
  'templates/agent-rules/partials/skill-routing-rules.md',
  'scripts/build-agent-rule-templates.ps1',
  'scripts/- build-agent-rule-templates.cmd',
  'scripts/validate-toolkit.cjs',
  'scripts/sync-toolkit-projects.cjs',
  'scripts/audit-project-source-locks.cjs',
  'scripts/watch-project-sources.cjs',
  'scripts/package-skills.cjs',
  'scripts/package-packs.cjs',
  'scripts/safe-source-update.cjs',
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
  'skills/design/ui-ux-secure-frontend-design',
  'skills/development/windows-localhost-workflows',
  'skills/automation/n8n-workflow-sync',
  'skills/automation/n8n-local-setup',
  'skills/cicd/secure-cicd-installer',
  'guides/ai-agent-platforms',
  'guides/mcp',
  'guides/n8n',
  'guides/cicd',
  'guides/design',
  'templates/agent-rules',
  'templates/agent-rules/partials',
  'templates/mcp-configs',
  'templates/n8n/sync-helpers',
  'templates/n8n/sanitizer',
  'templates/n8n/workflow-policy',
  'tools/design-system-generator',
  'tools/design-system-generator/scripts',
  'tools/design-system-generator/data',
  'tools/design-system-generator/data/stacks',
  'tools/design-system-generator/tests',
  'packs/frontend-design-skill',
  'packs/design-system-generator',
  'packs/codex-n8n-local',
  'packs/claude-code-n8n-local',
  'packs/secure-cicd',
  'packs/n8n-workflow-sync',
  'mcp/registry-mcp',
  'mcp/installer-mcp',
  'mcp/projects',
  '.github/workflows'
];

const registryFiles = [
  'registry/skills.registry.json',
  'registry/guides.registry.json',
  'registry/templates.registry.json',
  'registry/packs.registry.json',
  'registry/projects.registry.json',
  'registry/tools.registry.json',
  'registry/source-repos.registry.json',
  'registry/consumers.registry.json'
];

const staleReferenceRoots = [
  'README.md',
  'docs',
  'guides',
  'templates',
  'packs',
  'skills',
  'MIGRATION_CHECKLIST.md',
  'tests',
  'scripts',
  'registry'
];

const allowedExecutablePrefixes = [
  'scripts/',
  'tests/',
  '.github/workflows/',
  'tools/design-system-generator/scripts/',
  'tools/design-system-generator/tests/',
  'templates/n8n/sync-helpers/',
  'templates/n8n/sanitizer/'
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
    entry.relPath.startsWith('registry/') && /\.(ya?ml)$/i.test(entry.relPath)
  );
  for (const entry of yamlRegistries) fail(errors, `YAML registry file is not allowed: ${entry.relPath}`);
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

  const designSkill = 'skills/design/ui-ux-secure-frontend-design/SKILL.md';
  const expectedDescription = 'Security-first frontend UI/UX design skill for creating, reviewing, and improving web interfaces. Use for design systems, landing pages, SaaS dashboards, forms, component planning, accessibility, responsive polish, privacy-safe UX, and implementation review.';
  const designMatter = parseFrontMatter(readText(designSkill));
  if (designMatter?.name !== 'ui-ux-secure-frontend-design') fail(errors, 'Design skill front matter name is not approved');
  if (designMatter?.description !== expectedDescription) fail(errors, 'Design skill front matter description is not approved');

  const openai = readText('skills/design/ui-ux-secure-frontend-design/agents/openai.yaml').trim() + '\n';
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

  for (const entry of listFiles().filter((item) => item.relPath.startsWith('skills/design/ui-ux-secure-frontend-design/') && item.relPath.endsWith('.md'))) {
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
        rel.startsWith('tools/design-system-generator/scripts/') ||
        rel.startsWith('tools/design-system-generator/tests/') ||
        rel.startsWith('tests/');
      if (!allowedPython) fail(errors, `Python file outside approved locations: ${rel}`);
    }
    const allowed = allowedExecutablePrefixes.some((prefix) => rel.startsWith(prefix));
    if (!allowed) fail(errors, `Executable file outside approved locations: ${rel}`);
    if (rel.startsWith('skills/')) fail(errors, `Instruction-only skill contains executable file: ${rel}`);
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
    if (!existsRel(`tools/design-system-generator/data/${file}`)) fail(errors, `Missing design generator data file: ${file}`);
  }
  for (const file of requiredStacks) {
    if (!existsRel(`tools/design-system-generator/data/stacks/${file}`)) fail(errors, `Missing design generator stack data file: ${file}`);
  }

  const scriptFiles = listFiles().filter((entry) =>
    entry.relPath.startsWith('tools/design-system-generator/scripts/') && entry.relPath.endsWith('.py')
  );

  for (const entry of scriptFiles) {
    const text = fs.readFileSync(entry.fullPath, 'utf8').toLowerCase();
    for (const token of designGeneratorForbiddenTokens) {
      if (text.includes(token)) {
        fail(errors, `Design generator script contains forbidden local-only token "${token}": ${entry.relPath}`);
      }
    }
  }

  const licenseNotes = readText('tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md');
  if (!licenseNotes.includes('nextlevelbuilder/ui-ux-pro-max-skill') || !licenseNotes.includes('MIT')) {
    fail(errors, 'Design generator third-party licence notes must mention upstream project and MIT licence');
  }
}

function validateProjectModules(errors) {
  const result = projectSync.validateAndSync();
  for (const error of result.errors) fail(errors, error);
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
  const rootPartialFiles = listFiles().filter((entry) => entry.relPath.startsWith('templates/agent-rules/partials/'));
  for (const entry of rootPartialFiles) {
    if (!linkedOutputs.has(entry.relPath)) fail(errors, `Root agent-rule partial is an unmanaged duplicate: ${entry.relPath}`);
  }
}

function validateStaleReferences(errors) {
  const roots = new Set(staleReferenceRoots);
  for (const entry of listFiles()) {
    const top = entry.relPath.split('/')[0];
    if (!roots.has(top) && !roots.has(entry.relPath)) continue;
    const text = fs.readFileSync(entry.fullPath, 'utf8');
    if (text.includes(registryYamlText) || text.includes('registry/skills.' + 'yaml') || text.includes('registry/guides.' + 'yaml')) {
      fail(errors, `Stale registry YAML reference found in ${entry.relPath}`);
    }
    if (text.includes(packYamlText)) fail(errors, `Stale pack YAML reference found in ${entry.relPath}`);
    for (const token of ['known-' + 'repos', 'Known Repo ' + 'Patterns', 'ian-trending-' + 'system']) {
      if (text.includes(token)) fail(errors, `Stale project-specific reference "${token}" found in ${entry.relPath}`);
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

function validateWorkflows(errors) {
  const workflowFiles = listFiles().filter((entry) => entry.relPath.startsWith('.github/workflows/') && /\.ya?ml$/i.test(entry.relPath));
  for (const entry of workflowFiles) {
    const text = fs.readFileSync(entry.fullPath, 'utf8');
    const isGeneratedTemplateWorkflow = entry.relPath.endsWith('build-agent-rule-templates.yml');
    const isSourceWatchWorkflow = entry.relPath.endsWith('source-watch-plan.yml');
    if (!/^permissions:\s*$/m.test(text)) fail(errors, `${entry.relPath} missing explicit permissions block`);
    if (/contents:\s*write/i.test(text) && !isGeneratedTemplateWorkflow && !isSourceWatchWorkflow) fail(errors, `${entry.relPath} uses contents: write`);
    if (/pull-requests:\s*write/i.test(text) && !isSourceWatchWorkflow) fail(errors, `${entry.relPath} uses pull-requests: write`);
    if (/auto-merge|gh\s+pr\s+merge/i.test(text)) fail(errors, `${entry.relPath} contains forbidden merge behavior`);
    if (/git\s+commit|git\s+push/i.test(text) && !isGeneratedTemplateWorkflow && !isSourceWatchWorkflow) fail(errors, `${entry.relPath} contains forbidden commit/push behavior`);
    if (isGeneratedTemplateWorkflow && /git\s+commit|git\s+push/i.test(text)) {
      const allowedAdd = 'git add templates/agent-rules/AGENTS.md templates/agent-rules/CLAUDE.md templates/agent-rules/GEMINI.md';
      if (!text.includes(allowedAdd)) fail(errors, `${entry.relPath} auto-commit is not scoped to generated agent rule templates`);
      if (!/github\.event_name == 'pull_request'/.test(text) || !/head\.repo\.full_name == github\.repository/.test(text)) {
        fail(errors, `${entry.relPath} auto-commit must be limited to same-repo pull request branches`);
      }
      if (!/head\.ref != 'main'/.test(text)) fail(errors, `${entry.relPath} auto-commit must not run on main`);
    }
    if (entry.relPath.endsWith('safe-source-update.yml') && !/issues:\s*write/i.test(text)) {
      fail(errors, `${entry.relPath} should use issues: write for issue summaries`);
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
  validateForbiddenFiles(errors);
  validateJsonRegistries(errors);
  validatePacks(errors);
  validateSkills(errors);
  validateExecutables(errors);
  validateDesignGeneratorLocalOnly(errors);
  validateProjectModules(errors);
  validateSourceLocks(errors);
  validateAgentRuleSources(errors);
  validateStaleReferences(errors);
  validateSecretStrings(errors);
  validateWorkflows(errors);
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
  parseFrontMatter,
  projectManifests,
  runValidation,
  skillDirs,
  validateForbiddenFiles,
  validateDesignGeneratorLocalOnly,
  validateStaleReferences,
  validateSecretStrings
};
