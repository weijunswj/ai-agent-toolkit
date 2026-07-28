#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TRUSTED_ROOT = path.join(REPO_ROOT, 'repo', 'scripts', 'trusted-workflows');
const MANIFEST_PATH = path.join(TRUSTED_ROOT, 'closure-manifest.json');
const VALIDATION_ONLY = new Set([
  'build-closure-manifest.cjs',
  'update-bootstrap-digests.cjs'
]);

function fail(code) {
  process.stderr.write(code + '\n');
  process.exit(2);
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function contained(relative) {
  if (typeof relative !== 'string' || relative === '' || path.isAbsolute(relative)) fail('TW_VERIFY_PATH');
  const parts = relative.replace(/\\/g, '/').split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) fail('TW_VERIFY_PATH');
  const absolute = path.resolve(TRUSTED_ROOT, ...parts);
  const rel = path.relative(TRUSTED_ROOT, absolute);
  if (rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) fail('TW_VERIFY_ESCAPE');
  return absolute;
}

function listTrustedFiles() {
  const result = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail('TW_VERIFY_SYMLINK');
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name !== 'closure-manifest.json') {
        const relative = path.relative(TRUSTED_ROOT, absolute).replace(/\\/g, '/');
        if (!VALIDATION_ONLY.has(entry.name)) result.push(relative);
      }
    }
  };
  visit(TRUSTED_ROOT);
  return result.sort();
}

function main() {
  if (process.argv.length < 3 || process.argv.length > 4) fail('TW_VERIFY_ARGUMENTS');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    fail('TW_VERIFY_MANIFEST_PARSE');
  }
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.roots)) {
    fail('TW_VERIFY_MANIFEST_SCHEMA');
  }
  const listed = manifest.files.map((entry) => entry.path);
  if (new Set(listed).size !== listed.length) fail('TW_VERIFY_DUPLICATE');
  const actual = listTrustedFiles();
  if (JSON.stringify(actual) !== JSON.stringify([...listed].sort())) fail('TW_VERIFY_SET');
  for (const entry of manifest.files) {
    const file = contained(entry.path);
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0x0d)) fail('TW_VERIFY_NON_CANONICAL_LF');
    if (!fs.statSync(file).isFile() || digest(file) !== entry.sha256) fail('TW_VERIFY_HASH');
  }
  const requestedRoot = process.argv[2];
  if (!manifest.roots.includes(requestedRoot)) fail('TW_VERIFY_ROOT');
  const rootPath = contained(requestedRoot);
  if (process.argv.length === 3) {
    process.stdout.write(JSON.stringify({ protocol_version: 1, verified: true, root: requestedRoot }) + '\n');
    return;
  }
  let args;
  try {
    args = JSON.parse(process.argv[3]);
  } catch {
    fail('TW_VERIFY_CHILD_ARGUMENTS');
  }
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) fail('TW_VERIFY_CHILD_ARGUMENTS');
  const child = childProcess.spawnSync(process.execPath, [rootPath, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
    env: { ...process.env, NODE_OPTIONS: '' },
    shell: false,
    maxBuffer: 1024 * 1024
  });
  if (child.error || child.status !== 0 || child.signal || child.stderr !== '') fail('TW_VERIFY_CHILD_FAILED');
  if (!/^\{[^\r\n]*\}\n$/.test(child.stdout)) fail('TW_VERIFY_CHILD_PROTOCOL');
  process.stdout.write(child.stdout);
}

main();
