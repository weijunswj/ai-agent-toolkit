#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function fail(code) {
  process.stderr.write(code + '\n');
  process.exit(2);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function resolveLauncher(name) {
  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const suffixes = process.platform === 'win32' ? ['.cmd', '.exe'] : [''];
  const matches = [];
  for (const directory of pathEntries) {
    for (const suffix of suffixes) {
      const candidate = path.resolve(directory, name + suffix);
      try {
        if (fs.statSync(candidate).isFile()) matches.push(candidate);
      } catch {}
    }
  }
  if (matches.length === 0) fail('TW_CAPTURE_LAUNCHER_MISSING');
  return matches[0];
}

function real(file) {
  try {
    return fs.realpathSync.native(file);
  } catch {
    fail('TW_CAPTURE_REALPATH_FAILED');
  }
}

function publicIdentity(file) {
  return crypto.createHash('sha256').update(real(file)).digest('hex');
}

function validateLauncher(file, nodePath) {
  const content = fs.readFileSync(file, 'utf8').slice(0, 4096);
  if (process.platform === 'win32') {
    if (!/%~dp0\\node(?:\.exe)?/i.test(content)) fail('TW_CAPTURE_LAUNCHER_INTERPRETER');
    const sibling = path.join(path.dirname(file), 'node.exe');
    if (real(sibling).toLowerCase() !== nodePath.toLowerCase()) fail('TW_CAPTURE_LAUNCHER_IDENTITY');
    return;
  }
  const firstLine = content.split(/\r?\n/, 1)[0];
  if (!/^#!\/usr\/bin\/env node$/.test(firstLine) && !/^#!\S*\/node$/.test(firstLine)) {
    fail('TW_CAPTURE_LAUNCHER_INTERPRETER');
  }
}

function main() {
  if (process.argv.length !== 3 || !/^[1-9][0-9]*$/.test(process.argv[2])) {
    fail('TW_CAPTURE_ARGUMENTS');
  }
  const nodePath = real(process.execPath);
  const npmPath = real(resolveLauncher('npm'));
  const npxPath = real(resolveLauncher('npx'));
  validateLauncher(npmPath, nodePath);
  validateLauncher(npxPath, nodePath);
  const version = process.versions.node;
  const result = {
    protocol_version: 1,
    setup_generation: Number(process.argv[2]),
    node_version: version,
    node_major: Number(version.split('.')[0]),
    node_exec_path: publicIdentity(nodePath),
    node_realpath: publicIdentity(nodePath),
    node_sha256: sha256(nodePath),
    npm_exec_path: publicIdentity(npmPath),
    npm_realpath: publicIdentity(npmPath),
    npx_exec_path: publicIdentity(npxPath),
    npx_realpath: publicIdentity(npxPath),
    path_identity_digest: crypto.createHash('sha256').update(String(process.env.PATH || '')).digest('hex'),
    platform: process.platform,
    architecture: process.arch
  };
  process.stdout.write(JSON.stringify(result) + '\n');
}

main();
