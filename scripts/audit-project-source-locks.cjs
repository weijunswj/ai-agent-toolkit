#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const allowedSourceLifecycles = new Set(['active', 'retired_after_migration']);
const allowedSourceRoles = new Set(['migration_provenance_only', 'third_party_attribution_source']);
const allowedSourceUpdatePolicies = new Set(['none', 'manual_review_required']);

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

function validateLifecycleMetadata(lock, relPath, errors) {
  for (const key of ['source_lifecycle', 'source_role', 'source_update_policy', 'public_attribution_required']) {
    if (!(key in lock)) errors.push(`${relPath} missing ${key}`);
  }

  if ('source_lifecycle' in lock && !allowedSourceLifecycles.has(lock.source_lifecycle)) {
    errors.push(`${relPath} unknown source_lifecycle "${lock.source_lifecycle}"`);
  }
  if ('source_role' in lock && !allowedSourceRoles.has(lock.source_role)) {
    errors.push(`${relPath} unknown source_role "${lock.source_role}"`);
  }
  if ('source_update_policy' in lock && !allowedSourceUpdatePolicies.has(lock.source_update_policy)) {
    errors.push(`${relPath} unknown source_update_policy "${lock.source_update_policy}"`);
  }
  if ('public_attribution_required' in lock && typeof lock.public_attribution_required !== 'boolean') {
    errors.push(`${relPath} public_attribution_required must be boolean`);
  }

  if (lock.source_lifecycle === 'retired_after_migration') {
    if (lock.source_role !== 'migration_provenance_only') {
      errors.push(`${relPath} retired migration source must use source_role migration_provenance_only`);
    }
    if (lock.source_update_policy !== 'none') {
      errors.push(`${relPath} retired migration source must use source_update_policy none`);
    }
    if (lock.public_attribution_required !== false) {
      errors.push(`${relPath} retired migration source must set public_attribution_required false`);
    }
  }

  if (lock.source_role === 'third_party_attribution_source') {
    if (lock.source_lifecycle !== 'active') {
      errors.push(`${relPath} third-party attribution source must use source_lifecycle active`);
    }
    if (lock.source_update_policy !== 'manual_review_required') {
      errors.push(`${relPath} third-party attribution source must use source_update_policy manual_review_required`);
    }
    if (lock.public_attribution_required !== true) {
      errors.push(`${relPath} third-party attribution source must set public_attribution_required true`);
    }
  }
}

function validateLock(lock, relPath, errors) {
  for (const key of ['source_repo', 'source_ref', 'source_commit', 'files']) {
    if (!(key in lock)) errors.push(`${relPath} missing ${key}`);
  }
  validateLifecycleMetadata(lock, relPath, errors);
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
  hashFile,
  validateLifecycleMetadata
};
