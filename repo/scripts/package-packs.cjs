#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const checkMode = process.argv.includes('--check');
const required = ['id', 'title', 'description', 'status', 'risk_level', 'source_refs', 'suitable_for', 'installs', 'writes_allowed', 'writes_denied', 'requires_approval', 'run_commands', 'notes'];

function slash(value) {
  return value.split(path.sep).join('/');
}

function packFiles() {
  const result = [];
  const skillsRoot = path.join(root, 'skills');
  if (!fs.existsSync(skillsRoot)) return result;
  for (const skill of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!skill.isDirectory()) continue;
    const packsRoot = path.join(skillsRoot, skill.name, 'packs');
    if (!fs.existsSync(packsRoot)) continue;
    for (const pack of fs.readdirSync(packsRoot, { withFileTypes: true })) {
      if (!pack.isDirectory()) continue;
      const manifest = path.join(packsRoot, pack.name, 'pack.json');
      if (fs.existsSync(manifest)) result.push(manifest);
    }
  }
  return result.sort();
}

function validatePack(filePath) {
  const rel = slash(path.relative(root, filePath));
  const pack = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  for (const key of required) {
    if (!(key in pack)) throw new Error(`${rel} missing ${key}`);
  }
  if (pack.requires_approval !== true) throw new Error(`${rel} must require approval`);
  if (pack.run_commands !== false) throw new Error(`${rel} must not run commands by default`);
  for (const installPath of pack.installs || []) {
    if (!fs.existsSync(path.join(root, installPath))) throw new Error(`${rel} references missing install path: ${installPath}`);
  }
  return { ...pack, path: rel };
}

function copyDeclared(pack, outDir) {
  const packOut = path.join(outDir, pack.id);
  fs.mkdirSync(packOut, { recursive: true });
  fs.writeFileSync(path.join(packOut, 'pack.json'), JSON.stringify(pack, null, 2) + '\n');
  fs.writeFileSync(path.join(packOut, 'install-plan.json'), JSON.stringify(pack, null, 2) + '\n');
}

function main() {
  const packs = packFiles().map(validatePack);
  if (checkMode) {
    console.log(`Pack package check passed for ${packs.length} pack(s).`);
    return;
  }

  const outDir = path.join(root, '_dist', 'packs');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const pack of packs) copyDeclared(pack, outDir);
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ packs }, null, 2) + '\n');
  console.log(`Packaged ${packs.length} pack plan(s) into ${slash(path.relative(root, outDir))}.`);
}

if (require.main === module) main();

module.exports = { validatePack };
