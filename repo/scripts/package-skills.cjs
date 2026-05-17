#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseFrontMatter, skillDirs } = require('./validate-toolkit.cjs');

const root = process.cwd();
const checkMode = process.argv.includes('--check');

function slash(value) {
  return value.split(path.sep).join('/');
}

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDir(sourcePath, targetPath);
    else fs.copyFileSync(sourcePath, targetPath);
  }
}

function validateSkill(skillDir) {
  const full = path.join(root, skillDir);
  const readme = path.join(full, 'README.md');
  const skill = path.join(full, 'SKILL.md');
  if (!fs.existsSync(readme)) throw new Error(`${skillDir} missing README.md`);
  if (!fs.existsSync(skill)) throw new Error(`${skillDir} missing SKILL.md`);
  const frontMatter = parseFrontMatter(fs.readFileSync(skill, 'utf8').replace(/^\uFEFF/, ''));
  if (!frontMatter?.name || !frontMatter?.description) throw new Error(`${skillDir} missing SKILL.md name or description`);
  return {
    id: frontMatter.name,
    path: slash(skillDir),
    description: frontMatter.description
  };
}

function main() {
  const skills = skillDirs().map(validateSkill);
  if (checkMode) {
    console.log(`Skill package check passed for ${skills.length} skill(s).`);
    return;
  }

  const outDir = path.join(root, '_dist', 'skills');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const skill of skills) {
    copyDir(path.join(root, skill.path), path.join(outDir, skill.id));
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ skills }, null, 2) + '\n');
  console.log(`Packaged ${skills.length} skill(s) into ${slash(path.relative(root, outDir))}.`);
}

if (require.main === module) main();

module.exports = { validateSkill };
