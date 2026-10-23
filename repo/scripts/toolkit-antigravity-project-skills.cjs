#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ManagedSkillCopies, copySummary } = require('./toolkit-skill-copies.cjs');

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PORTABLE_SKILLS_RELATIVE_PATH = path.join('.agents', 'skills');
// Skills that only run Toolkit itself; the native plugins carry them, the portable copy does not.
// repo/docs/SKILL-SAFETY-MATRIX.md "Packaging" lists the same set (validate-toolkit.cjs checks it).
const INTERNAL_SKILLS = Object.freeze(['controller-bootstrap', 'github-program-reconciler', 'toolkit-env', 'toolkit-setup']);

function parseArgs(argv = process.argv.slice(2)) {
  const args = { projectRoot: '', write: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--project-root') args.projectRoot = argv[++index] || '';
    else if (arg.startsWith('--project-root=')) args.projectRoot = arg.slice('--project-root='.length);
    else if (arg === '--write') args.write = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.help && !args.projectRoot) throw new Error('--project-root <absolute-path> is required');
  if (args.projectRoot && !path.isAbsolute(args.projectRoot)) throw new Error('--project-root must be an absolute path');
  return args;
}

function lstatIfExists(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function listPortableSkills(sourceSkillsRoot) {
  const rootInfo = lstatIfExists(sourceSkillsRoot);
  if (!rootInfo || rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error('Toolkit source skills directory is unavailable');
  }
  const skills = [];
  for (const entry of fs.readdirSync(sourceSkillsRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !SKILL_NAME_PATTERN.test(entry.name) || INTERNAL_SKILLS.includes(entry.name)) continue;
    const skillRoot = path.join(sourceSkillsRoot, entry.name);
    const manifest = lstatIfExists(path.join(skillRoot, 'SKILL.md'));
    if (!manifest) continue;
    if (manifest.isSymbolicLink() || !manifest.isFile()) throw new Error('Toolkit source skill manifest is not a regular file');
    const files = [];
    const visit = (directory, relativeDirectory = '') => {
      for (const child of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const fullPath = path.join(directory, child.name);
        const relativePath = path.join(relativeDirectory, child.name);
        const info = fs.lstatSync(fullPath);
        if (info.isSymbolicLink()) throw new Error('Toolkit source skill contains a symbolic link; refusing to copy it');
        if (info.isDirectory()) visit(fullPath, relativePath);
        else if (info.isFile()) files.push({ relativePath, content: fs.readFileSync(fullPath) });
      }
    };
    visit(skillRoot);
    skills.push({ name: entry.name, files });
  }
  if (!skills.length) throw new Error('Toolkit source contains no portable skills');
  return skills;
}

function inspectDirectory(projectRoot, relativePath, missingDirectories) {
  const fullPath = path.join(projectRoot, relativePath);
  const info = lstatIfExists(fullPath);
  if (!info) {
    missingDirectories.add(fullPath);
    return false;
  }
  if (info.isSymbolicLink()) throw new Error('Antigravity skills target cannot contain a symbolic link or junction');
  if (!info.isDirectory()) throw new Error('Antigravity skills target path is not a directory');
  return true;
}

function inspectProjectRoot(projectRoot) {
  if (!path.isAbsolute(projectRoot)) throw new Error('--project-root must be an absolute path');
  const info = lstatIfExists(projectRoot);
  if (!info) throw new Error('Project root does not exist');
  if (info.isSymbolicLink()) throw new Error('Project root cannot be a symbolic link or junction');
  if (!info.isDirectory()) throw new Error('Project root must be a directory');
  return path.resolve(projectRoot);
}

function collectCopyPlan(projectRoot, sourceSkillsRoot) {
  const root = inspectProjectRoot(projectRoot);
  const skills = listPortableSkills(sourceSkillsRoot);
  const missingDirectories = new Set();
  inspectDirectory(root, '.agents', missingDirectories);
  inspectDirectory(root, PORTABLE_SKILLS_RELATIVE_PATH, missingDirectories);
  const missingFiles = [];
  let sourceFileCount = 0;

  for (const skill of skills) {
    const skillRelativeRoot = path.join(PORTABLE_SKILLS_RELATIVE_PATH, skill.name);
    const skillRootExists = inspectDirectory(root, skillRelativeRoot, missingDirectories);
    for (const file of skill.files) {
      sourceFileCount += 1;
      const fileRelativePath = path.join(skillRelativeRoot, file.relativePath);
      const fullPath = path.join(root, fileRelativePath);
      let parentExists = skillRootExists;
      const components = file.relativePath.split(path.sep);
      for (let index = 0; index < components.length - 1; index += 1) {
        const parentRelative = path.join(skillRelativeRoot, ...components.slice(0, index + 1));
        const parentPath = path.join(root, parentRelative);
        const info = parentExists ? lstatIfExists(parentPath) : null;
        if (!info) {
          parentExists = false;
          missingDirectories.add(parentPath);
          continue;
        }
        if (info.isSymbolicLink()) throw new Error('Antigravity skills target cannot contain a symbolic link or junction');
        if (!info.isDirectory()) throw new Error('Antigravity skills target path is not a directory');
      }

      const info = parentExists ? lstatIfExists(fullPath) : null;
      if (!info) {
        missingFiles.push({ fullPath, relativePath: fileRelativePath, content: file.content });
        continue;
      }
      if (info.isSymbolicLink()) throw new Error('Antigravity skill file cannot be a symbolic link or junction');
      if (!info.isFile()) throw new Error('Antigravity skill target exists and is not a regular file');
      if (!fs.readFileSync(fullPath).equals(file.content)) {
        throw new Error(`Antigravity skill file already exists with different content; refusing to overwrite: ${fileRelativePath.split(path.sep).join('/')}`);
      }
    }
  }

  return {
    root,
    skills,
    sourceFileCount,
    missingDirectories: [...missingDirectories].sort((a, b) => a.length - b.length),
    missingFiles
  };
}

function ensureDirectory(directory) {
  try {
    fs.mkdirSync(directory);
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
  }
  const info = lstatIfExists(directory);
  if (!info || info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('Antigravity skills target changed during copy; refusing to continue');
  }
}

// One portable-skill copy into a project. The plan is a read-only inspection taken
// at construction; apply() creates only missing directories and files, exclusively,
// and never overwrites existing content.
class PortableSkillCopyOperation {
  #plan; #write;
  constructor({ projectRoot, sourceSkillsRoot, write = false }) {
    this.#plan = collectCopyPlan(projectRoot, sourceSkillsRoot);
    this.#write = write;
    Object.freeze(this);
  }

  get target() { return PORTABLE_SKILLS_RELATIVE_PATH.split(path.sep).join('/'); }

  summary() {
    return { status: 'dry-run', target: this.target, skills: this.#plan.skills.length, files: this.#plan.sourceFileCount,
      files_to_copy: this.#plan.missingFiles.length, wrote: false };
  }

  #createFile(file) {
    let descriptor;
    try {
      descriptor = fs.openSync(file.fullPath, 'wx', 0o644);
      fs.writeFileSync(descriptor, file.content);
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch { /* preserve the original error */ }
      }
      if (error && error.code === 'EEXIST') throw new Error('Antigravity skill target appeared during copy; refusing to overwrite');
      throw error;
    }
    fs.closeSync(descriptor);
    return file.relativePath.split(path.sep).join('/');
  }

  apply() {
    for (const directory of this.#plan.missingDirectories) ensureDirectory(directory);
    const copied = this.#plan.missingFiles.map(file => this.#createFile(file));
    return { status: copied.length ? 'copied' : 'already-current', target: this.target, skills: this.#plan.skills.length,
      files: this.#plan.sourceFileCount, files_copied: copied.length, wrote: copied.length > 0 };
  }

  run() { return this.#write ? this.apply() : this.summary(); }
}
// Toolkit's portable skills in Antigravity's global skills folder (~/.gemini/config/skills), copied and
// kept current by setup when the user chooses it. Toolkit records its copies in
// ~/.ai-agent-toolkit/antigravity-toolkit-skills.json and only updates or removes those.
class AntigravityGlobalSkills extends ManagedSkillCopies {
  #homeDir;
  constructor({ toolkitRoot, homeDir = os.homedir(), controlRoot } = {}) {
    const sourceRoot = path.join(toolkitRoot, 'skills');
    super({
      sourceRoot,
      ledgerPath: path.join(controlRoot || path.join(homeDir, '.ai-agent-toolkit'), 'antigravity-toolkit-skills.json'),
      ledgerSchema: 'ai-agent-toolkit.antigravity-toolkit-skills.v1',
      targets: () => [path.join(homeDir, '.gemini', 'config', 'skills')],
      include: (name) => SKILL_NAME_PATTERN.test(name) && !INTERNAL_SKILLS.includes(name) && fs.existsSync(path.join(sourceRoot, name, 'SKILL.md')),
    });
    this.#homeDir = homeDir;
  }

  // Antigravity is installed when its ~/.gemini folder exists.
  installed() { return fs.existsSync(path.join(this.#homeDir, '.gemini')); }
}

function globalCopySummary(result) { return copySummary(result).join('; ') || 'nothing to copy'; }

function copyPortableSkills({ projectRoot, sourceSkillsRoot, write = false }) {return new PortableSkillCopyOperation({projectRoot,sourceSkillsRoot,write}).run();}

function printHelp() {
  console.log([
    'Copy portable Toolkit skills into an Antigravity workspace.',
    'Dry-run is the default. --write copies only skill files into .agents/skills.',
    '',
    'Usage:',
    '  node repo/scripts/toolkit-antigravity-project-skills.cjs --project-root <absolute-path>',
    '  node repo/scripts/toolkit-antigravity-project-skills.cjs --project-root <absolute-path> --write'
  ].join('\n'));
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { status: 0 };
  }
  const sourceSkillsRoot = path.resolve(__dirname, '..', '..', 'skills');
  const result = copyPortableSkills({ ...args, sourceSkillsRoot });
  console.log(JSON.stringify(result, null, 2));
  return { status: 0, result };
}

if (require.main === module) {
  try {
    process.exit(run().status || 0);
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { AntigravityGlobalSkills, INTERNAL_SKILLS, copyPortableSkills, globalCopySummary, parseArgs, run };
