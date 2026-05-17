#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

function slash(value) {
  return value.split(path.sep).join('/');
}

function resolveRel(relPath) {
  return path.join(root, relPath);
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(resolveRel(relPath), 'utf8').replace(/^\uFEFF/, ''));
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

function gitBlobSha(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(header).update(buffer).digest('hex');
}

function hashFile(relPath) {
  return gitBlobSha(fs.readFileSync(resolveRel(relPath)));
}

function discoverLockFiles() {
  return walk(resolveRel('_projects'))
    .filter((entry) => entry.dirent.isFile() && entry.relPath.endsWith('/SOURCE-LOCK.json'))
    .map((entry) => entry.relPath)
    .sort();
}

function validateLock(lock, relPath, errors) {
  for (const key of ['source_repo', 'source_ref', 'source_commit', 'files']) {
    if (!(key in lock)) errors.push(`${relPath} missing ${key}`);
  }
  if (!Array.isArray(lock.files)) {
    errors.push(`${relPath} files must be an array`);
    return;
  }

  for (const file of lock.files) {
    const mode = file.mode || 'exact';
    const localPath = file.project_path || file.root_surface_path;
    const label = localPath || file.source_path || '<unknown>';
    if (!file.source_path) errors.push(`${relPath} entry missing source_path: ${label}`);
    if (file.project_path && file.root_surface_path) errors.push(`${relPath} entry must not set both project_path and root_surface_path: ${label}`);

    if (mode === 'exact') {
      if (!localPath) errors.push(`${relPath} exact entry missing project_path or root_surface_path: ${label}`);
      if (!file.source_blob_sha) errors.push(`${relPath} exact entry missing source_blob_sha: ${label}`);
      if (localPath && !fs.existsSync(resolveRel(localPath))) {
        errors.push(`${relPath} exact entry missing local file: ${localPath}`);
        continue;
      }
      if (localPath && file.source_blob_sha) {
        const actual = hashFile(localPath);
        if (actual !== file.source_blob_sha) {
          errors.push(`${relPath} exact-copy drift: ${localPath} expected ${file.source_blob_sha} got ${actual}`);
        }
      }
    } else if (mode === 'adapted') {
      if (!file.notes) errors.push(`${relPath} adapted entry needs notes: ${label}`);
      if (!localPath) errors.push(`${relPath} adapted entry missing project_path or root_surface_path: ${label}`);
      if (localPath && !fs.existsSync(resolveRel(localPath))) {
        errors.push(`${relPath} adapted entry missing local file: ${localPath}`);
      }
    } else if (mode === 'excluded') {
      if (!file.notes) errors.push(`${relPath} excluded entry needs notes: ${label}`);
      if (file.project_path) errors.push(`${relPath} excluded entry must not set project_path: ${label}`);
      if (file.root_surface_path) errors.push(`${relPath} excluded entry must not set root_surface_path: ${label}`);
    } else {
      errors.push(`${relPath} unknown source lock mode "${mode}": ${label}`);
    }
  }
}

function auditSourceLocks() {
  const errors = [];
  const locks = discoverLockFiles();
  if (!locks.length) errors.push('No SOURCE-LOCK.json files found under _projects/');
  for (const relPath of locks) {
    try {
      validateLock(readJson(relPath), relPath, errors);
    } catch (error) {
      errors.push(`${relPath} is not valid JSON: ${error.message}`);
    }
  }
  return { errors, locks };
}

if (require.main === module) {
  const { errors, locks } = auditSourceLocks();
  if (errors.length) {
    for (const error of errors) console.error(`FAIL: ${error}`);
    console.error(`\nSummary: ${errors.length} source lock error(s).`);
    process.exit(1);
  }
  console.log(`Project source-lock audit passed for ${locks.length} lock file(s).`);
}

module.exports = {
  auditSourceLocks,
  discoverLockFiles,
  gitBlobSha,
  hashFile
};
