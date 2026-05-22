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
const agentRuleSpecPath = path.join(root, 'repo', 'scripts', 'agent-rule-template-specs.json');
const agentRuleSpecDocument = JSON.parse(fs.readFileSync(agentRuleSpecPath, 'utf8'));

function hydrateAgentRuleTemplateSpecs() {
  return agentRuleSpecDocument.templateSpecs.map((spec) => ({
    ...spec,
    partialSources: spec.payloadSources.map((sourceId) => {
      const source = agentRuleSpecDocument.partialSources[sourceId];
      if (!source) throw new Error(`Unknown agent-rule partial source id: ${sourceId}`);
      return { id: sourceId, ...source };
    }),
    templates: spec.templates.map((template) => ({ ...template }))
  }));
}

const agentRuleTemplateSpecDefinitions = hydrateAgentRuleTemplateSpecs();
const agentRulePartialSourceRels = new Set(Object.values(agentRuleSpecDocument.partialSources).map((source) => source.rel));

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
    if (output.text_rewrites !== undefined) {
      if (!Array.isArray(output.text_rewrites)) {
        fail(errors, `${project.id} output text_rewrites must be an array: ${output.output}`);
      } else {
        for (const rewrite of output.text_rewrites) {
          if (!rewrite || typeof rewrite.from !== 'string' || typeof rewrite.to !== 'string') {
            fail(errors, `${project.id} output text_rewrites entries require from and to strings: ${output.output}`);
          }
        }
      }
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

function templateDestinationDisplay(template) {
  return template.destinationDisplay || `\`${template.destination}\``;
}

function templateActiveNameText(template) {
  return template.activeNameText || `it is not named ${templateDestinationDisplay(template)}`;
}

function relativeMarkdownLink(fromRelPath, targetRelPath) {
  const href = path.posix.relative(path.posix.dirname(fromRelPath), targetRelPath);
  return `[${targetRelPath}](${href || path.posix.basename(targetRelPath)})`;
}

function expectedAgentRuleTemplate(spec, template, options = {}) {
  const outputPath = options.outputPath || template.output;
  const baselinePaths = options.baselinePaths || template.sourceBaselineTemplatePaths || template.baselineTemplatePaths || [];
  const destinationDisplay = templateDestinationDisplay(template);
  const bodyParts = [
    `# ${template.title}`,
    '',
    `Use this generated template for ${template.audience}.`,
    '',
    `This file is inert while it keeps the \`.template.md\` filename. It is safe to keep inside a skill folder because ${templateActiveNameText(template)}.`
  ];

  if (template.installMode === 'add_on' || template.installMode === 'toolkit_add_on') {
    bodyParts.push('');
    if (template.installMode === 'toolkit_add_on') {
      bodyParts.push('This optional add-on contains toolkit skill-routing rules only.');
      bodyParts.push('');
      bodyParts.push("Use it only when the target environment has this toolkit's `skills/` folders installed or copied.");
      bodyParts.push('');
      bodyParts.push('Do not use it as a standalone replacement for generic AGENTS/CLAUDE/GEMINI rules.');
      bodyParts.push('');
      bodyParts.push('First install or copy the generic baseline rules from:');
    } else {
      bodyParts.push('This is an n8n-specific add-on. It does not include the generic AI coding agent baseline rules.');
      bodyParts.push('');
      bodyParts.push('First install or copy the generic baseline rules from:');
    }
    bodyParts.push('');
    for (const baselinePath of baselinePaths) bodyParts.push(`- ${relativeMarkdownLink(outputPath, baselinePath)}`);
    bodyParts.push('');
    if (template.installMode === 'toolkit_add_on') {
      bodyParts.push('Then merge the fenced payload from this file under the generic baseline in the same active instruction file.');
      bodyParts.push('');
      bodyParts.push('Do not overwrite existing active instruction files. Merge manually or produce a diff/merge plan.');
    } else {
      bodyParts.push('Then merge the fenced payload from this file under the generic rules in the same active instruction file.');
      bodyParts.push('');
      bodyParts.push('Do not use this add-on alone to create a fresh active instruction file.');
      bodyParts.push('');
      bodyParts.push(`If the target repo already has ${destinationDisplay}, do not overwrite it. Merge manually or produce a diff/merge plan.`);
    }
  } else {
    bodyParts.push('');
    bodyParts.push(`Copy or merge the fenced payload into the target repo root as ${destinationDisplay} only when the user explicitly wants ${template.installSubject} installed.`);
    bodyParts.push('');
    bodyParts.push(`If the target repo already has ${destinationDisplay}, do not overwrite it. Merge manually or produce a diff/merge plan.`);

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

function expectedAgentRuleSourceTemplate(spec, template) {
  return expectedAgentRuleTemplate(spec, template);
}

function normalizeWorkspaceRel(value) {
  return path.posix.normalize(value.replace(/\\/g, '/'));
}

function hasPathTraversal(value) {
  const slashValue = value.replace(/\\/g, '/');
  const normalized = normalizeWorkspaceRel(value);
  return slashValue.split('/').includes('..') || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../');
}

function isAbsolutePathLike(value) {
  return path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function validateAgentRulePartialSource(errors, spec, source) {
  if (typeof source.rel !== 'string') {
    fail(errors, `${spec.projectId} agent-rule partial source must be a string`);
    return;
  }
  if (!agentRulePartialSourceRels.has(source.rel)) {
    fail(errors, `${spec.projectId} agent-rule partial source must be declared in agent-rule-template-specs.json: ${source.rel}`);
  }
  let validWorkspacePath = true;
  if (isAbsolutePathLike(source.rel)) {
    fail(errors, `${spec.projectId} agent-rule partial source must not be absolute: ${source.rel}`);
    validWorkspacePath = false;
  }
  if (hasPathTraversal(source.rel)) {
    fail(errors, `${spec.projectId} agent-rule partial source must not traverse outside workspace: ${source.rel}`);
    validWorkspacePath = false;
  }

  const normalized = normalizeWorkspaceRel(source.rel);
  if (!normalized.startsWith('_projects/')) {
    fail(errors, `${spec.projectId} agent-rule partial source must start with _projects/: ${source.rel}`);
    validWorkspacePath = false;
  }
  if (!normalized.includes('/_main/_partials/')) {
    fail(errors, `${spec.projectId} agent-rule partial source must stay in project _main/_partials/: ${source.rel}`);
    validWorkspacePath = false;
  }
  if (validWorkspacePath && !fs.existsSync(resolveRel(normalized))) {
    fail(errors, `Missing agent-rule partial source: ${source.rel}`);
  }
}

function validateAgentRuleTemplatePath(errors, spec, template, field, label) {
  if (!Object.prototype.hasOwnProperty.call(template, field)) return false;
  const value = template[field];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(errors, `${spec.projectId} agent-rule ${label} must be a non-empty string`);
    return true;
  }
  if (isAbsolutePathLike(value)) {
    fail(errors, `${spec.projectId} agent-rule ${label} must not be absolute: ${value}`);
  }
  if (hasPathTraversal(value)) {
    fail(errors, `${spec.projectId} agent-rule ${label} must not traverse outside workspace: ${value}`);
  }

  const normalized = normalizeWorkspaceRel(value);
  if (field === 'output') {
    if (!normalized.startsWith('_projects/') || !normalized.includes('/_main/')) {
      fail(errors, `${spec.projectId} agent-rule output must stay under _projects/**/_main/**: ${value}`);
    }
  } else if (!approvedOutputPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    fail(errors, `${spec.projectId} agent-rule published output must stay under skills/ or mcp/: ${value}`);
  }
  return true;
}

function validateAgentRuleTemplateSpecs(errors, projects) {
  const declaredProjectIds = new Set(projects.map((project) => project.id));
  for (const spec of agentRuleTemplateSpecDefinitions) {
    if (!declaredProjectIds.has(spec.projectId)) continue;
    for (const source of spec.partialSources) {
      validateAgentRulePartialSource(errors, spec, source);
    }
    for (const template of spec.templates) {
      const hasOutput = validateAgentRuleTemplatePath(errors, spec, template, 'output', 'output');
      const hasPublishedOutput = validateAgentRuleTemplatePath(errors, spec, template, 'publishedOutput', 'published output');
      if (!hasOutput && !hasPublishedOutput) {
        fail(errors, `${spec.projectId} agent-rule template requires output or publishedOutput: ${template.fileName || '<unknown>'}`);
      }
    }
  }
}

function validateAgentRuleSpecSources(errors, spec, project) {
  if (!project) {
    fail(errors, `${spec.projectId} agent-rule spec project is not declared`);
    return;
  }
  for (const source of spec.partialSources) {
    if (!agentRulePartialSourceRels.has(source.rel)) {
      fail(errors, `${spec.projectId} agent-rule partial source must be declared in agent-rule-template-specs.json: ${source.rel}`);
    }
    if (!source.rel.startsWith('_projects/') || !source.rel.includes('/_main/_partials/')) {
      fail(errors, `${spec.projectId} agent-rule partial source must stay in project _main/_partials/: ${source.rel}`);
    }
  }
}

function sourceSideAgentRuleTemplates(projects) {
  const declaredProjectIds = new Set(projects.map((project) => project.id));
  const templates = [];
  for (const spec of agentRuleTemplateSpecDefinitions) {
    if (!declaredProjectIds.has(spec.projectId)) continue;
    for (const template of spec.templates) {
      if (template.output) templates.push({ spec, template });
    }
  }
  return templates;
}

function validateAgentRuleSourceTemplates(errors, projects) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const sourceSideTemplates = sourceSideAgentRuleTemplates(projects);
  if (!sourceSideTemplates.length) return;

  const specsWithSourceSideTemplates = new Set(sourceSideTemplates.map(({ spec }) => spec));
  for (const spec of specsWithSourceSideTemplates) {
    const project = projectById.get(spec.projectId);
    validateAgentRuleSpecSources(errors, spec, project);
  }
  if (errors.length) return;

  const specsWithMissingPartials = new Set();
  for (const spec of specsWithSourceSideTemplates) {
    for (const source of spec.partialSources) {
      if (!fs.existsSync(resolveRel(source.rel))) {
        specsWithMissingPartials.add(spec);
        fail(errors, `Missing agent-rule partial source: ${source.rel}`);
      }
    }
  }

  for (const { spec, template } of sourceSideTemplates) {
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

function publishedAgentRuleTemplateSpec(project, output) {
  if (output.kind !== 'copy') return null;
  for (const spec of agentRuleTemplateSpecDefinitions) {
    if (spec.projectId !== project.id) continue;
    const template = spec.templates.find((candidate) => {
      if (candidate.publishedOutput !== output.output) return false;
      return !output.agent_rule_template || candidate.fileName === output.agent_rule_template;
    });
    if (template) return { spec, template };
  }
  return null;
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

function applyTextRewrites(text, output) {
  if (!Array.isArray(output.text_rewrites) || !output.text_rewrites.length) return text;
  let rewritten = text;
  for (const rewrite of output.text_rewrites) {
    if (!rewrite || typeof rewrite.from !== 'string' || typeof rewrite.to !== 'string') {
      throw new Error(`${output.output} text_rewrites entries require from and to strings`);
    }
    rewritten = rewritten.split(rewrite.from).join(rewrite.to);
  }
  return rewritten;
}

function finalizeTextOutput(text, project, output, relPaths) {
  const rewritten = applyTextRewrites(text, output);
  if (path.extname(output.output).toLowerCase() === '.md' && output.notice !== false) {
    return addMarkdownNotice(rewritten, project, relPaths);
  }
  return rewritten.trimEnd() + '\n';
}

function expectedTextOutput(project, output, rels) {
  if (output.kind === 'extract') {
    const raw = readText(rels[0]);
    const startIndex = raw.indexOf(output.start);
    if (startIndex === -1) throw new Error(`${project.id} extract start marker not found in ${rels[0]}: ${output.output}`);
    const endIndex = raw.indexOf(output.end, startIndex + output.start.length);
    if (endIndex === -1) throw new Error(`${project.id} extract end marker not found in ${rels[0]}: ${output.output}`);
    const extracted = raw.slice(startIndex, endIndex).trimEnd() + '\n';
    return finalizeTextOutput(extracted, project, output, rels[0]);
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
    return finalizeTextOutput(bodyParts.join('\n').trimEnd() + '\n', project, output, rels);
  }

  const publishedAgentRule = publishedAgentRuleTemplateSpec(project, output);
  if (publishedAgentRule) {
    return finalizeTextOutput(
      expectedAgentRuleTemplate(publishedAgentRule.spec, publishedAgentRule.template, {
        outputPath: output.output,
        baselinePaths: publishedAgentRule.template.baselineTemplatePaths
      }),
      project,
      output,
      rels[0]
    );
  }
  const raw = readText(rels[0]);
  if (output.kind === 'json' || path.extname(output.output).toLowerCase() === '.json') {
    return applyTextRewrites(JSON.stringify(JSON.parse(raw), null, 2) + '\n', output).trimEnd() + '\n';
  }
  return finalizeTextOutput(raw, project, output, rels[0]);
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

  validateAgentRuleTemplateSpecs(errors, projects);
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

  validateAgentRuleSourceTemplates(errors, projects);
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
