#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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
const mode = process.argv.includes('--write') ? 'write' : 'check';
const projectRoot = '_projects';
const approvedOutputPrefixes = ['skills/', 'mcp/'];
const rootSurfacePrefixes = ['skills/', 'mcp/'];
const forbiddenNames = new Set([
  '.n8n-local',
  '.tmp',
  '.to-sanitise',
  '.sanitised',
  '.n8n-workflow-backups',
  'node_modules',
  'dist',
  '_dist',
  'coverage',
  'exports',
  'original',
  'derived'
]);
const forbiddenDeniedPolicy = ['.env*', '**/*credential*', '**/*.key', '**/*.pem'];
const supportedKinds = new Set(['copy', 'concat', 'curated', 'extract', 'json', 'linked']);
const textOutputExtensions = new Set(['.md', '.json', '.ps1']);
const supportedPublishSurfaces = new Set(['skill', 'mcp', 'both', 'source_only']);
const supportedSurfaceStatuses = new Set(['published', 'candidate', 'not_applicable']);
const supportedFidelityValues = new Set(['exact', 'reviewed_entrypoint', 'catalogue_summary', 'generated_metadata']);
const agentRuleTemplateSpecDefinitions = [
  {
    projectId: 'n8n.local-setup',
    partialSources: [
      {
        name: 'ai-coding-agent-execution.md',
        rel: '_projects/n8n/local-setup/_main/templates/partials/ai-coding-agent-execution.md'
      },
      {
        name: 'n8n-mcp-rules.md',
        rel: '_projects/n8n/local-setup/_main/templates/partials/n8n-mcp-rules.md'
      }
    ],
    skillRoutingSource: 'skills/n8n-local-setup/templates/agent-rules/partials/skill-routing-rules.md',
    templates: [
      {
        source: '_main/templates/agent-rules/AGENTS.template.md',
        output: '_projects/n8n/local-setup/_main/templates/agent-rules/AGENTS.template.md',
        title: 'AGENTS.template.md AI coding agent and n8n MCP workflow rules',
        audience: 'Codex or OpenCode',
        destination: 'AGENTS.md',
        installSubject: 'Codex/OpenCode rules',
        installExamples: [
          {
            heading: 'Codex global rules example',
            path: 'C:\\Users\\<your-user>\\.codex\\AGENTS.md',
            commands: ['mkdir $HOME\\.codex -Force', 'notepad $HOME\\.codex\\AGENTS.md']
          },
          {
            heading: 'OpenCode global rules example',
            path: 'C:\\Users\\<your-user>\\.config\\opencode\\AGENTS.md',
            commands: ['mkdir $HOME\\.config\\opencode -Force', 'notepad $HOME\\.config\\opencode\\AGENTS.md']
          }
        ]
      },
      {
        source: '_main/templates/agent-rules/CLAUDE.template.md',
        output: '_projects/n8n/local-setup/_main/templates/agent-rules/CLAUDE.template.md',
        title: 'CLAUDE.template.md AI coding agent and n8n MCP workflow rules',
        audience: 'Claude Code',
        destination: 'CLAUDE.md',
        installSubject: 'Claude Code rules',
        installExamples: [
          {
            heading: 'Claude Code global rules example',
            path: 'C:\\Users\\<your-user>\\.claude\\CLAUDE.md',
            commands: ['mkdir $HOME\\.claude -Force', 'notepad $HOME\\.claude\\CLAUDE.md']
          }
        ]
      },
      {
        source: '_main/templates/agent-rules/GEMINI.template.md',
        output: '_projects/n8n/local-setup/_main/templates/agent-rules/GEMINI.template.md',
        title: 'GEMINI.template.md AI coding agent and n8n MCP workflow rules',
        audience: 'Gemini CLI or Antigravity',
        destination: 'GEMINI.md',
        installSubject: 'Gemini CLI/Antigravity rules',
        installExamples: [
          {
            heading: 'Gemini CLI and Antigravity global rules example',
            path: 'C:\\Users\\<your-user>\\.gemini\\GEMINI.md',
            commands: ['mkdir $HOME\\.gemini -Force', 'notepad $HOME\\.gemini\\GEMINI.md']
          }
        ]
      }
    ]
  }
];

function agentRuleTemplateSpecs() {
  return JSON.parse(JSON.stringify(agentRuleTemplateSpecDefinitions));
}

function slash(value) {
  return value.split(path.sep).join('/');
}

function resolveRel(relPath) {
  return path.join(root, relPath);
}

function readText(relPath) {
  return fs.readFileSync(resolveRel(relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function readBuffer(relPath) {
  return fs.readFileSync(resolveRel(relPath));
}

function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

function writeText(relPath, content) {
  const full = resolveRel(relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.replace(/\r\n/g, '\n'), 'utf8');
}

function writeBuffer(relPath, content) {
  const full = resolveRel(relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function walk(dir, entries = []) {
  if (!fs.existsSync(dir)) return entries;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === '.git' || item.name === '__pycache__') continue;
    const fullPath = path.join(dir, item.name);
    entries.push({ fullPath, relPath: slash(path.relative(root, fullPath)), dirent: item });
    if (item.isDirectory()) walk(fullPath, entries);
  }
  return entries;
}

function listFiles(relDir) {
  return walk(resolveRel(relDir)).filter((entry) => entry.dirent.isFile());
}

function listFilesIfExists(relDir) {
  return fs.existsSync(resolveRel(relDir)) ? listFiles(relDir) : [];
}

function fail(errors, message) {
  errors.push(message);
}

function discoverProjectFiles() {
  return listFilesIfExists(projectRoot)
    .filter((entry) => entry.relPath.endsWith('/toolkit.project.json'))
    .map((entry) => entry.relPath)
    .sort();
}

function discoverProjectModuleDirs() {
  const modules = [];
  const rootDir = resolveRel(projectRoot);
  if (!fs.existsSync(rootDir)) return modules;
  for (const category of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const categoryDir = path.join(rootDir, category.name);
    for (const project of fs.readdirSync(categoryDir, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      modules.push(slash(path.relative(root, path.join(categoryDir, project.name))));
    }
  }
  return modules.sort();
}

function projectManifests() {
  return discoverProjectFiles().map((relPath) => readJson(relPath));
}

function isApprovedOutputPath(relPath) {
  return approvedOutputPrefixes.some((prefix) => relPath.startsWith(prefix)) && !relPath.includes('..');
}

function isRootSurfacePath(relPath) {
  return rootSurfacePrefixes.some((prefix) => relPath.startsWith(prefix));
}

function validateForbiddenFiles(errors, project) {
  for (const entry of walk(resolveRel(project.main_path))) {
    const rel = entry.relPath;
    const name = path.basename(rel);
    const lower = rel.toLowerCase();

    if (entry.dirent.isDirectory()) {
      if (forbiddenNames.has(name)) fail(errors, `${project.id} forbidden directory in _main/: ${rel}`);
      continue;
    }

    if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) fail(errors, `${project.id} forbidden env file in _main/: ${rel}`);
    if (lower.endsWith('.zip') || lower.endsWith('.tgz')) fail(errors, `${project.id} generated package artifact in _main/: ${rel}`);
    if (lower.endsWith('.live-export.json') || lower.endsWith('.live-import.json')) fail(errors, `${project.id} live n8n import/export in _main/: ${rel}`);
    const safeExampleJson = lower.endsWith('.example.json') || lower.endsWith('-example.json');
    if (!safeExampleJson && /credential.*\.json$/i.test(name) && !lower.endsWith('package.json')) fail(errors, `${project.id} credential-looking JSON in _main/: ${rel}`);
    if (/binding.*\.json$/i.test(name)) fail(errors, `${project.id} credential binding-looking JSON in _main/: ${rel}`);
    if (['.pem', '.key', '.p12', '.pfx'].some((ext) => lower.endsWith(ext))) fail(errors, `${project.id} private key/certificate in _main/: ${rel}`);
  }
}

function validateWritePolicy(errors, project) {
  if (!project.writes || !Array.isArray(project.writes.allowed) || !Array.isArray(project.writes.denied)) {
    fail(errors, `${project.id} writes.allowed and writes.denied must be arrays`);
    return;
  }
  for (const denied of forbiddenDeniedPolicy) {
    if (!project.writes.denied.includes(denied)) fail(errors, `${project.id} writes.denied should include ${denied}`);
  }
  if (project.requires_approval !== true) fail(errors, `${project.id} requires_approval must be true`);
  if (project.run_commands_by_default !== false) fail(errors, `${project.id} run_commands_by_default must be false`);
  if (project.live_actions !== 'explicit_confirmation_only') fail(errors, `${project.id} live_actions must be explicit_confirmation_only`);
  if (project.ci_live_actions !== false) fail(errors, `${project.id} ci_live_actions must be false`);
}

function validateProjectShape(errors, relPath) {
  let project;
  try {
    project = readJson(relPath);
  } catch (error) {
    fail(errors, `${relPath} is not valid JSON: ${error.message}`);
    return null;
  }

  for (const key of ['id', 'category', 'name', 'title', 'module_path', 'main_path', 'outputs', 'writes', 'requires_approval', 'run_commands_by_default', 'live_actions', 'ci_live_actions']) {
    if (!(key in project)) fail(errors, `${relPath} missing ${key}`);
  }
  if ('exports_path' in project) fail(errors, `${relPath} must not use exports_path`);
  if (!Array.isArray(project.outputs)) fail(errors, `${relPath} outputs must be an array`);
  if (!project.project || typeof project.project !== 'object') {
    fail(errors, `${relPath} missing project metadata`);
  } else {
    for (const key of ['name', 'category', 'summary']) {
      if (!project.project[key]) fail(errors, `${relPath} project.${key} is required`);
    }
  }
  if (!project.surface || typeof project.surface !== 'object') {
    fail(errors, `${relPath} missing surface metadata`);
  } else {
    if (!supportedPublishSurfaces.has(project.surface.publish_as)) {
      fail(errors, `${relPath} surface.publish_as must be one of skill, mcp, both, source_only`);
    }
    for (const key of ['skill', 'mcp']) {
      const surface = project.surface[key];
      if (!surface || typeof surface !== 'object') {
        fail(errors, `${relPath} surface.${key} metadata is required`);
        continue;
      }
      if (!supportedSurfaceStatuses.has(surface.status)) {
        fail(errors, `${relPath} surface.${key}.status must be one of published, candidate, not_applicable`);
      }
      if (surface.status !== 'not_applicable' && (!surface.path || !surface.summary)) {
        fail(errors, `${relPath} surface.${key} requires path and summary unless status is not_applicable`);
      }
    }
  }

  const expectedModulePath = slash(path.dirname(relPath));
  if (project.module_path !== expectedModulePath) fail(errors, `${relPath} module_path should be ${expectedModulePath}`);
  if (project.main_path !== `${expectedModulePath}/_main`) fail(errors, `${relPath} main_path should be ${expectedModulePath}/_main`);

  for (const required of ['README.md', 'SOURCE-MANIFEST.md', 'SOURCE-LOCK.json', '_main']) {
    if (!fs.existsSync(resolveRel(`${project.module_path}/${required}`))) fail(errors, `${project.id} missing ${required}`);
  }
  for (const forbidden of ['main', 'exports', 'original', 'derived']) {
    if (fs.existsSync(resolveRel(`${project.module_path}/${forbidden}`))) fail(errors, `${project.id} must not contain ${forbidden}/`);
  }

  validateWritePolicy(errors, project);
  if (project.main_path) validateForbiddenFiles(errors, project);

  for (const output of project.outputs || []) {
    if (!output.kind || !output.output) {
      fail(errors, `${project.id} output entries require kind and output`);
      continue;
    }
    if (!supportedKinds.has(output.kind)) fail(errors, `${project.id} unsupported output kind: ${output.kind}`);
    if (!isApprovedOutputPath(output.output)) fail(errors, `${project.id} output path is not an approved root surface: ${output.output}`);
    if (!project.writes?.allowed?.includes(output.output)) fail(errors, `${project.id} output is not declared in writes.allowed: ${output.output}`);
    if (output.fidelity && !supportedFidelityValues.has(output.fidelity)) {
      fail(errors, `${project.id} unsupported output fidelity: ${output.fidelity}`);
    }
    if (output.kind === 'linked') {
      if (output.source || output.sources) fail(errors, `${project.id} linked output must not set source or sources: ${output.output}`);
      if (!fs.existsSync(resolveRel(output.output))) fail(errors, `${project.id} linked output missing: ${output.output}`);
      continue;
    }
    if (output.kind === 'concat') {
      if (!Array.isArray(output.sources) || !output.sources.length) fail(errors, `${project.id} concat output requires sources: ${output.output}`);
    } else if (output.kind === 'extract') {
      if (!output.source) fail(errors, `${project.id} extract output requires source: ${output.output}`);
      if (!output.start || !output.end) fail(errors, `${project.id} extract output requires start and end markers: ${output.output}`);
    } else if (!output.source) {
      fail(errors, `${project.id} ${output.kind} output requires source: ${output.output}`);
    }
    if (output.kind === 'curated' && output.source && !slash(path.normalize(output.source)).startsWith('curated_output_for_ai/')) {
      fail(errors, `${project.id} curated output source must start with curated_output_for_ai/: ${output.output}`);
    }
  }

  return project;
}

function linkedOutputSet(projects) {
  const linked = new Set();
  for (const project of projects) {
    for (const output of project.outputs || []) {
      if (output.kind === 'linked') linked.add(output.output);
    }
  }
  return linked;
}

function sourceRel(project, source, linked) {
  const normalized = slash(path.normalize(source));
  if (normalized.startsWith('_main/')) return slash(path.join(project.module_path, normalized));
  if (normalized.startsWith('curated_output_for_ai/')) return slash(path.join(project.module_path, normalized));
  if (linked.has(normalized) && isRootSurfacePath(normalized)) return normalized;
  throw new Error(`${project.id} source must be under _main/, curated_output_for_ai/, or a linked root surface: ${source}`);
}

function sourceRels(project, output, linked) {
  if (output.kind === 'concat') return output.sources.map((source) => sourceRel(project, source, linked));
  return [sourceRel(project, output.source, linked)];
}

function isCuratedSource(project, relPath) {
  return relPath.startsWith(`${project.module_path}/curated_output_for_ai/`);
}

function generatedNotice(project, relPaths) {
  const paths = Array.isArray(relPaths) ? relPaths : [relPaths];
  const hasCurated = paths.some((relPath) => isCuratedSource(project, relPath));
  const message = hasCurated
    ? 'Generated from toolkit curated output for AI. Do not edit directly.'
    : 'Generated from toolkit project source. Do not edit directly.';
  const update = hasCurated
    ? 'Update the curated output and run sync.'
    : 'Update the project source and run sync.';
  return [
    '<!--',
    message,
    `Project: ${project.id}`,
    ...paths.map((relPath) => `Source: ${relPath}`),
    update,
    '-->',
    ''
  ].join('\n');
}

function agentRuleSourceTemplateNotice(spec) {
  return [
    '<!--',
    'Generated from toolkit project source. Do not edit directly.',
    `Project: ${spec.projectId}`,
    ...spec.partialSources.map((source) => `Source: ${source.rel}`),
    'Update the project source and run sync.',
    '-->',
    ''
  ].join('\n');
}

function expectedAgentRuleSourceTemplate(spec, template) {
  const bodyParts = [
    `# ${template.title}`,
    '',
    `Use this generated template for ${template.audience}.`,
    '',
    `This file is inert while it keeps the \`.template.md\` filename. It is safe to keep inside a skill folder because it is not named \`${template.destination}\`.`,
    '',
    `Copy or merge the fenced payload into the target repo root as \`${template.destination}\` only when the user explicitly wants ${template.installSubject} installed.`,
    '',
    `If the target repo already has \`${template.destination}\`, do not overwrite it. Merge manually or produce a diff/merge plan.`
  ];

  for (const example of template.installExamples) {
    bodyParts.push('');
    bodyParts.push(`## ${example.heading}`);
    bodyParts.push('');
    bodyParts.push('Copy or merge the fenced payload into:');
    bodyParts.push('');
    bodyParts.push('```text');
    bodyParts.push(example.path);
    bodyParts.push('```');
    bodyParts.push('');
    bodyParts.push('Or create it with PowerShell:');
    bodyParts.push('');
    bodyParts.push('```text');
    for (const command of example.commands) bodyParts.push(command);
    bodyParts.push('```');
  }

  const payloadParts = [];
  for (const source of spec.partialSources) {
    payloadParts.push(readText(source.rel).trimEnd());
  }

  bodyParts.push('');
  bodyParts.push('---');
  bodyParts.push('');
  bodyParts.push('````````md');
  bodyParts.push(payloadParts.join('\n\n').trimEnd());
  bodyParts.push('````````');

  return agentRuleSourceTemplateNotice(spec) + bodyParts.join('\n').trimEnd() + '\n';
}

function agentRuleSpecSourceIsProjectScoped(project, source) {
  const rel = typeof source === 'string' ? source : source.rel;
  if (!rel.startsWith('_projects/')) return true;
  return rel.startsWith(`${project.module_path}/`);
}

function validateAgentRuleRootSurfaceSource(errors, spec, linked, rel) {
  if (!rel) return;
  if (!isRootSurfacePath(rel)) {
    fail(errors, `${spec.projectId} agent-rule root-surface source must stay under skills/ or mcp/: ${rel}`);
  } else if (!linked.has(rel)) {
    fail(errors, `${spec.projectId} agent-rule root-surface source must be declared linked: ${rel}`);
  }
}

function validateAgentRuleSpecSources(errors, spec, project, linked) {
  if (!project) {
    fail(errors, `${spec.projectId} agent-rule spec project is not declared`);
    return;
  }
  for (const source of spec.partialSources) {
    if (source.rel.startsWith('_projects/') && !agentRuleSpecSourceIsProjectScoped(project, source)) {
      fail(errors, `${spec.projectId} agent-rule partial source must stay within its project: ${source.rel}`);
    } else if (isRootSurfacePath(source.rel)) {
      validateAgentRuleRootSurfaceSource(errors, spec, linked, source.rel);
    } else if (!source.rel.startsWith('_projects/')) {
      fail(errors, `${spec.projectId} agent-rule partial source must be project source or linked root surface: ${source.rel}`);
    }
  }
  validateAgentRuleRootSurfaceSource(errors, spec, linked, spec.skillRoutingSource);
}

function declaredAgentRuleSourceTemplates(projects) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const declared = [];
  for (const spec of agentRuleTemplateSpecDefinitions) {
    const project = projectById.get(spec.projectId);
    if (!project) continue;

    const declaredSources = new Set();
    for (const output of project.outputs || []) {
      if (typeof output.source === 'string') declaredSources.add(slash(path.normalize(output.source)));
    }

    for (const template of spec.templates) {
      if (declaredSources.has(template.source)) declared.push({ spec, template });
    }
  }
  return declared;
}

function validateAgentRuleSourceTemplates(errors, projects, linked) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const declaredTemplates = declaredAgentRuleSourceTemplates(projects);
  if (!declaredTemplates.length) return;

  const specsWithDeclaredTemplates = new Set(declaredTemplates.map(({ spec }) => spec));
  for (const spec of specsWithDeclaredTemplates) {
    const project = projectById.get(spec.projectId);
    validateAgentRuleSpecSources(errors, spec, project, linked);
  }
  if (errors.length) return;

  const specsWithMissingPartials = new Set();
  for (const spec of specsWithDeclaredTemplates) {
    for (const source of spec.partialSources) {
      if (!fs.existsSync(resolveRel(source.rel))) {
        specsWithMissingPartials.add(spec);
        fail(errors, `Missing agent-rule partial source: ${source.rel}`);
      }
    }
    if (spec.skillRoutingSource && !fs.existsSync(resolveRel(spec.skillRoutingSource))) {
      fail(errors, `Missing agent-rule root-surface source: ${spec.skillRoutingSource}`);
    }
  }

  for (const { spec, template } of declaredTemplates) {
    if (specsWithMissingPartials.has(spec)) continue;
    if (!fs.existsSync(resolveRel(template.output))) {
      fail(errors, `Missing source-side agent-rule template: ${template.output}`);
      continue;
    }
    if (readText(template.output) !== expectedAgentRuleSourceTemplate(spec, template)) {
      fail(errors, `Stale source-side agent-rule template: ${template.output}`);
    }
  }
}

function publishedAgentRuleTemplateSpec(project, output, rels) {
  if (output.kind !== 'copy' || rels.length !== 1) return null;
  const spec = agentRuleTemplateSpecDefinitions.find((candidate) => candidate.projectId === project.id);
  if (!spec?.skillRoutingSource) return null;
  const template = spec.templates.find((candidate) => candidate.output === rels[0]);
  if (!template) return null;
  return { spec, template };
}

function addSkillRoutingToAgentRuleTemplate(text, outputPath, skillRoutingSource) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const closingFence = '\n````````\n';
  if (!normalized.endsWith(closingFence)) {
    throw new Error(`agent-rule template missing closing 8-backtick fence: ${outputPath}`);
  }
  const payload = readText(skillRoutingSource).trimEnd();
  return `${normalized.slice(0, -closingFence.length)}\n\n${payload}${closingFence}`;
}

function addMarkdownNotice(text, project, relPaths) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const notice = generatedNotice(project, relPaths);
  if (!normalized.startsWith('---\n')) return notice + normalized.trimEnd() + '\n';

  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return notice + normalized.trimEnd() + '\n';
  const closeEnd = normalized.indexOf('\n', end + 1);
  const frontMatterEnd = closeEnd === -1 ? normalized.length : closeEnd + 1;
  return normalized.slice(0, frontMatterEnd) + '\n' + notice + normalized.slice(frontMatterEnd).trimStart().trimEnd() + '\n';
}

function expectedTextOutput(project, output, rels) {
  if (output.kind === 'extract') {
    const raw = readText(rels[0]);
    const startIndex = raw.indexOf(output.start);
    if (startIndex === -1) throw new Error(`${project.id} extract start marker not found in ${rels[0]}: ${output.output}`);
    const endIndex = raw.indexOf(output.end, startIndex + output.start.length);
    if (endIndex === -1) throw new Error(`${project.id} extract end marker not found in ${rels[0]}: ${output.output}`);
    const extracted = raw.slice(startIndex, endIndex).trimEnd() + '\n';
    if (path.extname(output.output).toLowerCase() === '.md' && output.notice !== false) {
      return addMarkdownNotice(extracted, project, rels[0]);
    }
    return extracted;
  }

  if (output.kind === 'concat') {
    const bodyParts = [];
    if (output.title) {
      bodyParts.push(`# ${output.title}`);
      bodyParts.push('');
    }
    if (output.intro) {
      bodyParts.push(output.intro);
      bodyParts.push('');
    }
    for (const rel of rels) {
      bodyParts.push(readText(rel).trimEnd());
      bodyParts.push('');
    }
    return addMarkdownNotice(bodyParts.join('\n').trimEnd() + '\n', project, rels);
  }

  const raw = readText(rels[0]);
  const publishedAgentRule = publishedAgentRuleTemplateSpec(project, output, rels);
  if (publishedAgentRule) {
    return addMarkdownNotice(
      addSkillRoutingToAgentRuleTemplate(raw, output.output, publishedAgentRule.spec.skillRoutingSource),
      project,
      [rels[0], publishedAgentRule.spec.skillRoutingSource]
    );
  }
  if (output.kind === 'json' || path.extname(output.output).toLowerCase() === '.json') {
    return JSON.stringify(JSON.parse(raw), null, 2) + '\n';
  }
  if (path.extname(output.output).toLowerCase() === '.md' && output.notice !== false) {
    return addMarkdownNotice(raw, project, rels[0]);
  }
  return raw.trimEnd() + '\n';
}

function expandRecipe(project, output, linked) {
  if (output.kind === 'linked') return [{ output: output.output, linked: true }];
  const rels = sourceRels(project, output, linked);
  for (const rel of rels) {
    if (!fs.existsSync(resolveRel(rel))) throw new Error(`${project.id} missing recipe source: ${rel}`);
  }

  if (output.kind === 'copy' && fs.statSync(resolveRel(rels[0])).isDirectory()) {
    return listFiles(rels[0]).map((entry) => {
      const child = slash(path.relative(resolveRel(rels[0]), entry.fullPath));
      return {
        output: slash(path.join(output.output, child)),
        source: entry.relPath,
        binary: true
      };
    });
  }

  const ext = path.extname(output.output).toLowerCase();
  const binaryCopy = output.kind === 'copy' && !textOutputExtensions.has(ext);
  return [{
    output: output.output,
    source: rels[0],
    sources: rels,
    binary: binaryCopy,
    text: binaryCopy ? null : expectedTextOutput(project, output, rels)
  }];
}

function syncExpanded(expanded, errors) {
  for (const item of expanded) {
    if (item.linked) continue;
    if (mode === 'write') {
      if (item.binary) writeBuffer(item.output, readBuffer(item.source));
      else writeText(item.output, item.text);
      continue;
    }

    if (!fs.existsSync(resolveRel(item.output))) {
      fail(errors, `Missing generated output: ${item.output}`);
      continue;
    }
    if (item.binary) {
      const current = readBuffer(item.output);
      const expected = readBuffer(item.source);
      if (!current.equals(expected)) fail(errors, `Stale generated output: ${item.output}`);
    } else if (readText(item.output) !== item.text) {
      fail(errors, `Stale generated output: ${item.output}`);
    }
  }
}

function registryEntries(projects) {
  return projects
    .map((project) => ({
      id: project.id,
      category: project.category,
      name: project.name,
      title: project.title,
      project: project.project,
      surface: project.surface,
      module_path: project.module_path,
      main_path: project.main_path,
      root_surfaces: [...new Set((project.outputs || []).map((output) => output.output))].sort()
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function fileHash(relPath) {
  return crypto.createHash('sha256').update(readBuffer(relPath)).digest('hex');
}

function sourceLockedRootSurfaces() {
  const result = new Set();
  for (const entry of listFilesIfExists(projectRoot).filter((item) => item.relPath.endsWith('/SOURCE-LOCK.json'))) {
    let lock;
    try {
      lock = readJson(entry.relPath);
    } catch {
      continue;
    }
    for (const file of lock.files || []) {
      if (file.root_surface_path) result.add(file.root_surface_path);
    }
  }
  return result;
}

function validateNoUnmanagedMirrors(errors, managedOutputs) {
  const sourceHashes = new Map();
  for (const entry of listFilesIfExists(projectRoot)) {
    if (!entry.relPath.includes('/_main/')) continue;
    const hash = fileHash(entry.relPath);
    const paths = sourceHashes.get(hash) || [];
    paths.push(entry.relPath);
    sourceHashes.set(hash, paths);
  }

  const lockedRootSurfaces = sourceLockedRootSurfaces();
  for (const entry of walk(root).filter((item) => item.dirent.isFile() && isRootSurfacePath(item.relPath))) {
    if (managedOutputs.has(entry.relPath) || lockedRootSurfaces.has(entry.relPath)) continue;
    const matches = sourceHashes.get(fileHash(entry.relPath));
    if (matches?.length) {
      fail(errors, `Unmanaged duplicate root surface: ${entry.relPath} mirrors ${matches[0]}`);
    }
  }
}

function validateAndSync() {
  const errors = [];
  const requiredProjectFiles = ['README.md', 'toolkit.project.json', 'SOURCE-MANIFEST.md', 'SOURCE-LOCK.json', '_main'];
  for (const moduleDir of discoverProjectModuleDirs()) {
    for (const required of requiredProjectFiles) {
      if (!fs.existsSync(resolveRel(`${moduleDir}/${required}`))) {
        fail(errors, `missing required project module file: ${moduleDir}/${required}`);
      }
    }
  }

  const projectFiles = discoverProjectFiles();
  if (!projectFiles.length) fail(errors, 'No toolkit project modules found under _projects/**/toolkit.project.json');

  const projects = projectFiles.map((file) => validateProjectShape(errors, file)).filter(Boolean);
  if (errors.length) return { errors, projects, expanded: [] };

  const linked = linkedOutputSet(projects);
  const expanded = [];
  for (const project of projects) {
    for (const output of project.outputs) {
      try {
        expanded.push(...expandRecipe(project, output, linked));
      } catch (error) {
        fail(errors, error.message);
      }
    }
  }
  if (errors.length) return { errors, projects, expanded };

  validateAgentRuleSourceTemplates(errors, projects, linked);
  if (errors.length && mode === 'write') return { errors, projects, expanded };

  syncExpanded(expanded, errors);

  const registryPath = 'mcp/registry/projects.registry.json';
  const expectedRegistry = JSON.stringify(registryEntries(projects), null, 2) + '\n';
  if (mode === 'write') {
    writeText(registryPath, expectedRegistry);
  } else {
    const currentRegistry = fs.existsSync(resolveRel(registryPath)) ? readText(registryPath) : null;
    if (currentRegistry !== expectedRegistry) fail(errors, `Stale generated output: ${registryPath}`);
  }

  const managedOutputs = new Set(expanded.map((item) => item.output));
  managedOutputs.add(registryPath);
  validateNoUnmanagedMirrors(errors, managedOutputs);

  return { errors, projects, expanded };
}

if (require.main === module) {
  const { errors, projects } = validateAndSync();
  if (errors.length) {
    for (const error of errors) console.error(`FAIL: ${error}`);
    console.error(`\nSummary: ${errors.length} project sync error(s).`);
    process.exit(1);
  }
  console.log(`Toolkit project ${mode === 'write' ? 'sync' : 'check'} passed for ${projects.length} project module(s).`);
}

module.exports = {
  validateAndSync,
  discoverProjectFiles,
  projectManifests,
  agentRuleTemplateSpecs,
  generatedNotice,
  addMarkdownNotice
};
