#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const mode = process.argv.includes('--write') ? 'write' : 'check';
const requiredExportDirs = ['skills', 'mcp', 'templates', 'packs', 'registry', 'guides'];
const approvedOutputPrefixes = ['skills/', 'mcp/', 'templates/', 'packs/', 'registry/', 'guides/', 'tools/'];
const forbiddenNames = new Set([
  '.n8n-local',
  '.tmp',
  '.to-sanitise',
  '.sanitised',
  '.n8n-workflow-backups',
  'node_modules',
  'dist',
  '_dist',
  'coverage'
]);
const forbiddenDeniedPolicy = ['.env*', '**/*credential*', '**/*.key', '**/*.pem'];

function slash(value) {
  return value.split(path.sep).join('/');
}

function resolveRel(relPath) {
  return path.join(root, relPath);
}

function readText(relPath) {
  return fs.readFileSync(resolveRel(relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

function writeText(relPath, content) {
  const full = resolveRel(relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.replace(/\r\n/g, '\n'), 'utf8');
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

function fail(errors, message) {
  errors.push(message);
}

function discoverProjectFiles() {
  return listFiles('projects')
    .filter((entry) => entry.relPath.endsWith('/toolkit.project.json'))
    .map((entry) => entry.relPath)
    .sort();
}

function assertInsideExport(project, source) {
  const rel = slash(path.normalize(path.join(project.module_path, source)));
  const exportsPrefix = `${project.exports_path}/`;
  if (!rel.startsWith(exportsPrefix)) {
    throw new Error(`${project.module_path} output source is outside exports/: ${source}`);
  }
  return rel;
}

function isApprovedOutputPath(relPath) {
  return approvedOutputPrefixes.some((prefix) => relPath.startsWith(prefix)) && !relPath.includes('..');
}

function validateForbiddenFiles(errors, project) {
  for (const entry of walk(resolveRel(project.main_path))) {
    const rel = entry.relPath;
    const name = path.basename(rel);
    const lower = rel.toLowerCase();

    if (entry.dirent.isDirectory()) {
      if (forbiddenNames.has(name)) fail(errors, `${project.id} forbidden directory in main/: ${rel}`);
      continue;
    }

    if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) fail(errors, `${project.id} forbidden env file in main/: ${rel}`);
    if (lower.endsWith('.zip') || lower.endsWith('.tgz')) fail(errors, `${project.id} generated package artifact in main/: ${rel}`);
    if (lower.endsWith('.live-export.json') || lower.endsWith('.live-import.json')) fail(errors, `${project.id} live n8n import/export in main/: ${rel}`);
    const safeExampleJson = lower.endsWith('.example.json') || lower.endsWith('-example.json');
    if (!safeExampleJson && /credential.*\.json$/i.test(name) && !lower.endsWith('package.json')) fail(errors, `${project.id} credential-looking JSON in main/: ${rel}`);
    if (/binding.*\.json$/i.test(name)) fail(errors, `${project.id} credential binding-looking JSON in main/: ${rel}`);
    if (['.pem', '.key', '.p12', '.pfx'].some((ext) => lower.endsWith(ext))) fail(errors, `${project.id} private key/certificate in main/: ${rel}`);
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

  for (const key of ['id', 'category', 'name', 'title', 'module_path', 'main_path', 'exports_path', 'outputs', 'writes', 'requires_approval', 'run_commands_by_default', 'live_actions', 'ci_live_actions']) {
    if (!(key in project)) fail(errors, `${relPath} missing ${key}`);
  }
  if (!Array.isArray(project.outputs)) fail(errors, `${relPath} outputs must be an array`);

  const expectedModulePath = slash(path.dirname(relPath));
  if (project.module_path !== expectedModulePath) fail(errors, `${relPath} module_path should be ${expectedModulePath}`);

  for (const required of ['README.md', 'SOURCE-MANIFEST.md', 'main', 'exports']) {
    if (!fs.existsSync(resolveRel(`${project.module_path}/${required}`))) fail(errors, `${project.id} missing ${required}`);
  }
  for (const dir of requiredExportDirs) {
    if (!fs.existsSync(resolveRel(`${project.exports_path}/${dir}`))) fail(errors, `${project.id} missing exports/${dir}/`);
  }

  validateWritePolicy(errors, project);
  validateForbiddenFiles(errors, project);

  const allowedWrites = new Set(project.writes?.allowed || []);
  for (const output of project.outputs || []) {
    if (!output.kind || !output.source || !output.output) {
      fail(errors, `${project.id} output entries require kind, source, and output`);
      continue;
    }
    let sourceRel;
    try {
      sourceRel = assertInsideExport(project, output.source);
    } catch (error) {
      fail(errors, error.message);
      continue;
    }
    if (!fs.existsSync(resolveRel(sourceRel))) fail(errors, `${project.id} missing declared export: ${sourceRel}`);
    if (!isApprovedOutputPath(output.output)) fail(errors, `${project.id} output path is not an approved root surface: ${output.output}`);
    if (!allowedWrites.has(output.output)) fail(errors, `${project.id} output is not declared in writes.allowed: ${output.output}`);
  }

  return project;
}

function generatedNotice(project, sourceRel) {
  return [
    '<!--',
    'Generated from toolkit project exports. Do not edit directly.',
    `Project: ${project.id}`,
    `Source: ${sourceRel}`,
    'Update the source project export and run the sync/check workflow.',
    '-->',
    ''
  ].join('\n');
}

function addMarkdownNotice(text, project, sourceRel) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const notice = generatedNotice(project, sourceRel);
  if (!normalized.startsWith('---\n')) return notice + normalized.trimEnd() + '\n';

  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return notice + normalized.trimEnd() + '\n';
  const closeEnd = normalized.indexOf('\n', end + 1);
  const frontMatterEnd = closeEnd === -1 ? normalized.length : closeEnd + 1;
  return normalized.slice(0, frontMatterEnd) + '\n' + notice + normalized.slice(frontMatterEnd).trimStart().trimEnd() + '\n';
}

function expectedOutput(project, output) {
  const sourceRel = assertInsideExport(project, output.source);
  const ext = path.extname(output.output).toLowerCase();
  const raw = readText(sourceRel);
  if (ext === '.md' && output.notice !== false) return addMarkdownNotice(raw, project, sourceRel);
  if (ext === '.json') return JSON.stringify(JSON.parse(raw), null, 2) + '\n';
  return raw.trimEnd() + '\n';
}

function registryEntries(projects) {
  return projects
    .map((project) => {
      const registryRel = `${project.exports_path}/registry/project.json`;
      return fs.existsSync(resolveRel(registryRel)) ? readJson(registryRel) : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function newestMtime(relDir) {
  const files = listFiles(relDir);
  if (!files.length) return 0;
  return Math.max(...files.map((entry) => fs.statSync(entry.fullPath).mtimeMs));
}

function warnMainChangedWithoutExports(projects) {
  for (const project of projects) {
    const mainTime = newestMtime(project.main_path);
    const exportsTime = newestMtime(project.exports_path);
    if (mainTime > exportsTime) {
      console.warn(`WARN: ${project.id} main/ is newer than exports/. Review whether curated exports need updates.`);
    }
  }
}

function validateAndSync() {
  const errors = [];
  const projectFiles = discoverProjectFiles();
  if (!projectFiles.length) fail(errors, 'No toolkit project modules found under projects/**/toolkit.project.json');

  const projects = projectFiles.map((file) => validateProjectShape(errors, file)).filter(Boolean);
  if (errors.length) return { errors, projects };

  for (const project of projects) {
    for (const output of project.outputs) {
      const expected = expectedOutput(project, output);
      const current = fs.existsSync(resolveRel(output.output)) ? readText(output.output) : null;
      if (mode === 'write') {
        writeText(output.output, expected);
      } else if (current !== expected) {
        fail(errors, `Stale generated output: ${output.output}`);
      }
    }
  }

  const registryPath = 'registry/projects.registry.json';
  const expectedRegistry = JSON.stringify(registryEntries(projects), null, 2) + '\n';
  if (mode === 'write') {
    writeText(registryPath, expectedRegistry);
  } else {
    const currentRegistry = fs.existsSync(resolveRel(registryPath)) ? readText(registryPath) : null;
    if (currentRegistry !== expectedRegistry) fail(errors, `Stale generated output: ${registryPath}`);
  }

  warnMainChangedWithoutExports(projects);
  return { errors, projects };
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
  generatedNotice,
  addMarkdownNotice
};
