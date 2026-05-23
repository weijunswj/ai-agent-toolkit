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
const allowedSourceLifecycles = new Set(['active', 'retired_after_migration']);
const allowedSourceRoles = new Set(['migration_provenance_only', 'third_party_attribution_source']);
const allowedSourceUpdatePolicies = new Set(['none', 'manual_review_required']);
const fullCommitShaPattern = /^[0-9a-f]{40}$/;
const knownRetiredInternalSourceRepos = new Set([
  'weijunswj/ai-cicd-installer',
  'weijunswj/codex-n8n-local-setup',
  'weijunswj/n8n-workflow-templates'
]);
// These prefixes are reserved toolkit-local source/maintenance namespaces.
// SOURCE-LOCK source_path values must usually describe upstream repo paths,
// not toolkit-local layout paths. A narrow exception exists for retired
// same-repo migrations from former root published surfaces, where skills/
// or mcp/ is the real pinned upstream path.
const toolkitLocalSourcePathPrefixes = ['_projects/', 'repo/'];
const sameRepoRootSurfaceSourcePathPrefixes = ['skills/', 'mcp/'];
const rootSurfacePathPrefixes = ['skills/', 'mcp/'];

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

function isRetiredMigrationLock(lock) {
  return lock &&
    lock.source_lifecycle === 'retired_after_migration' &&
    lock.source_role === 'migration_provenance_only' &&
    lock.source_update_policy === 'none' &&
    lock.public_attribution_required === false;
}

function isActiveThirdPartyAttributionLock(lock) {
  return lock &&
    lock.source_lifecycle === 'active' &&
    lock.source_role === 'third_party_attribution_source' &&
    lock.source_update_policy === 'manual_review_required' &&
    lock.public_attribution_required === true;
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

  if (lock.source_lifecycle === 'active') {
    if (lock.source_role !== 'third_party_attribution_source') {
      errors.push(`${relPath} active source must use source_role third_party_attribution_source`);
    }
    if (lock.source_update_policy !== 'manual_review_required') {
      errors.push(`${relPath} active source must use source_update_policy manual_review_required`);
    }
    if (lock.public_attribution_required !== true) {
      errors.push(`${relPath} active source must set public_attribution_required true`);
    }
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

  if (lock.source_role === 'migration_provenance_only' && lock.source_lifecycle !== 'retired_after_migration') {
    errors.push(`${relPath} migration provenance source must use source_lifecycle retired_after_migration`);
  }

  if (lock.source_update_policy === 'none' && lock.source_lifecycle !== 'retired_after_migration') {
    errors.push(`${relPath} source_update_policy none is allowed only for retired_after_migration sources`);
  }

  if (lock.source_role === 'third_party_attribution_source') {
    if (lock.source_lifecycle !== 'active') {
      errors.push(`${relPath} third-party attribution source must use source_lifecycle active`);
    }
    for (const key of ['source_repo', 'source_ref', 'source_commit']) {
      if (key in lock && (typeof lock[key] !== 'string' || !lock[key].trim())) {
        errors.push(`${relPath} active third-party ${key} must be a non-empty string`);
      }
    }
    if ('source_commit' in lock && (typeof lock.source_commit !== 'string' || !fullCommitShaPattern.test(lock.source_commit))) {
      errors.push(`${relPath} active third-party source_commit must be a 40-character SHA`);
    }
    if (lock.source_update_policy !== 'manual_review_required') {
      errors.push(`${relPath} third-party attribution source must use source_update_policy manual_review_required`);
    }
    if (lock.public_attribution_required !== true) {
      errors.push(`${relPath} third-party attribution source must set public_attribution_required true`);
    }
  }

  if (typeof lock.source_repo === 'string' && knownRetiredInternalSourceRepos.has(lock.source_repo) && !isRetiredMigrationLock(lock)) {
    errors.push(`${relPath} known retired internal source repo must stay retired_after_migration with migration_provenance_only and source_update_policy none: ${lock.source_repo}`);
  }
}

function isSameRepoRetiredRootSurfaceSource(lock, normalizedSourcePath) {
  return lock.source_repo === 'weijunswj/ai-agent-toolkit' &&
    lock.source_lifecycle === 'retired_after_migration' &&
    sameRepoRootSurfaceSourcePathPrefixes.some((prefix) => normalizedSourcePath.startsWith(prefix));
}

function validateSourcePathProvenance(lock, file, relPath, label, errors) {
  if (!file.source_path) return;
  const normalized = String(file.source_path).replace(/\\/g, '/');
  if (sameRepoRootSurfaceSourcePathPrefixes.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix))) {
    if (isSameRepoRetiredRootSurfaceSource(lock, normalized)) return;
    errors.push(`${relPath} root-surface source_path is allowed only for retired same-repo migrations: ${label} uses ${file.source_path}`);
    return;
  }
  for (const prefix of toolkitLocalSourcePathPrefixes) {
    if (normalized === prefix.slice(0, -1) || normalized.startsWith(prefix)) {
      errors.push(`${relPath} source_path must stay upstream-provenance, not toolkit-local: ${label} uses ${file.source_path}`);
      return;
    }
  }
}

function normalizeRepoRelativePath(value, fieldName, relPath, label, errors) {
  const raw = String(value).replace(/\\/g, '/');
  if (!raw) {
    errors.push(`${relPath} ${fieldName} must not be empty: ${label}`);
    return null;
  }
  if (/^[A-Za-z]:/.test(raw)) {
    errors.push(`${relPath} ${fieldName} must be repo-relative, not a Windows drive path: ${label} uses ${value}`);
    return null;
  }
  if (path.posix.isAbsolute(raw)) {
    errors.push(`${relPath} ${fieldName} must be repo-relative, not absolute: ${label} uses ${value}`);
    return null;
  }
  if (raw.split('/').includes('..')) {
    errors.push(`${relPath} ${fieldName} must not contain .. path segments: ${label} uses ${value}`);
    return null;
  }

  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === '.') {
    errors.push(`${relPath} ${fieldName} must not be empty: ${label}`);
    return null;
  }
  return normalized;
}

function validateLocalPathTopology(file, relPath, label, errors) {
  if (Object.prototype.hasOwnProperty.call(file, 'project_path')) {
    const normalized = normalizeRepoRelativePath(file.project_path, 'project_path', relPath, label, errors);
    if (normalized && !normalized.startsWith('_projects/')) {
      errors.push(`${relPath} project_path must point under _projects/: ${label} uses ${file.project_path}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(file, 'root_surface_path')) {
    const normalized = normalizeRepoRelativePath(file.root_surface_path, 'root_surface_path', relPath, label, errors);
    if (normalized && !rootSurfacePathPrefixes.some((prefix) => normalized.startsWith(prefix))) {
      errors.push(`${relPath} root_surface_path must point under skills/ or mcp/: ${label} uses ${file.root_surface_path}`);
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

  const isActiveThirdParty = lock.source_lifecycle === 'active' && lock.source_role === 'third_party_attribution_source';
  for (const file of lock.files) {
    const mode = file.mode || 'exact';
    const localPath = file.project_path || file.root_surface_path;
    const label = localPath || file.source_path || '<unknown>';
    if (!file.source_path) errors.push(`${relPath} entry missing source_path: ${label}`);
    validateSourcePathProvenance(lock, file, relPath, label, errors);
    validateLocalPathTopology(file, relPath, label, errors);
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
      if (isActiveThirdParty && !file.source_blob_sha) errors.push(`${relPath} adapted entry missing source_blob_sha: ${label}`);
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
  isActiveThirdPartyAttributionLock,
  isRetiredMigrationLock,
  knownRetiredInternalSourceRepos,
  normalizeRepoRelativePath,
  validateLifecycleMetadata,
  validateLocalPathTopology,
  validateSourcePathProvenance
};
