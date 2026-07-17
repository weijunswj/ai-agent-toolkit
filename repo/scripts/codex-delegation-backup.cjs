'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { backupRoot, codexConfigPath, sha256 } = require('./codex-delegation-common.cjs');

const BACKUP_SCHEMA = 'ai-agent-toolkit.codex-config-backup.v2';

function samePath(left, right) {
  const leftResolved = path.resolve(left);
  const rightResolved = path.resolve(right);
  return process.platform === 'win32'
    ? leftResolved.toLowerCase() === rightResolved.toLowerCase()
    : leftResolved === rightResolved;
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function statIdentity(stat) {
  if (!stat) return null;
  const value = (key) => Number.isFinite(stat[key]) ? stat[key] : null;
  return {
    dev: value('dev'),
    ino: value('ino'),
    ctime_ms: value('ctimeMs'),
    birthtime_ms: value('birthtimeMs'),
  };
}

function sameIdentity(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function writeJsonAtomically(filePath, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(5).toString('hex')}`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
    fs.renameSync(temp, filePath);
  } finally {
    try { fs.rmSync(temp, { force: true }); } catch {}
  }
}

function captureCodexConfigSnapshot(configPath = codexConfigPath()) {
  const resolvedPath = path.resolve(configPath);
  let stat;
  try {
    stat = fs.lstatSync(resolvedPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        config_path: resolvedPath,
        existed: false,
        file_type: 'missing',
        bytes: Buffer.alloc(0),
        size_bytes: 0,
        sha256: null,
        mode: null,
        identity: null,
      };
    }
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error('Codex config is a symbolic link; backup and mutation are refused.');
  if (!stat.isFile()) throw new Error('Codex config is not a regular file; backup and mutation are refused.');
  const realPath = fs.realpathSync.native ? fs.realpathSync.native(resolvedPath) : fs.realpathSync(resolvedPath);
  if (!samePath(realPath, resolvedPath)) throw new Error('Codex config resolves through a junction or reparse point; backup and mutation are refused.');
  const bytes = fs.readFileSync(resolvedPath);
  return {
    config_path: resolvedPath,
    existed: true,
    file_type: 'regular',
    bytes,
    size_bytes: bytes.length,
    sha256: sha256(bytes),
    mode: stat.mode & 0o7777,
    identity: statIdentity(stat),
  };
}

function snapshotsMatch(expected, current) {
  return expected.config_path === current.config_path
    && expected.existed === current.existed
    && expected.file_type === current.file_type
    && expected.size_bytes === current.size_bytes
    && expected.sha256 === current.sha256
    && expected.mode === current.mode
    && sameIdentity(expected.identity, current.identity);
}

function assertSnapshotCurrent(configPath, expected, message = 'Codex config changed while the isolated proposal was being prepared; refusing to overwrite the concurrent edit.') {
  const current = captureCodexConfigSnapshot(configPath);
  if (!snapshotsMatch(expected, current)) {
    throw new Error(message);
  }
  return current;
}

function createCodexConfigBackup(configPath = codexConfigPath(), options = {}) {
  const snapshot = options.snapshot || captureCodexConfigSnapshot(configPath);
  const current = assertSnapshotCurrent(configPath, snapshot);
  const id = options.generationId || `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(6).toString('hex')}`;
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id === '.' || id === '..') throw new Error('Backup generation ID is unsafe.');
  const root = path.resolve(options.backupRoot || backupRoot(configPath));
  const generation = path.join(root, id);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(generation, { recursive: false, mode: 0o700 });
  const backupPath = current.existed ? path.join(generation, 'config.toml.original') : null;
  if (backupPath) fs.writeFileSync(backupPath, current.bytes, { mode: 0o600 });
  const replacement = Buffer.from(options.replacementBytes || Buffer.alloc(0));
  const metadata = {
    schema: BACKUP_SCHEMA,
    generation: id,
    created_at: new Date().toISOString(),
    config_path: current.config_path,
    existed: current.existed,
    file_type: current.file_type,
    original_mode: current.mode,
    original_size_bytes: current.size_bytes,
    original_sha256: current.sha256,
    original_identity: current.identity,
    backup_path: backupPath,
    replacement_size_bytes: replacement.length,
    replacement_sha256: sha256(replacement),
  };
  const metadataPath = path.join(generation, 'restore.json');
  writeJsonAtomically(metadataPath, metadata, 0o600);
  return { ...metadata, metadata_path: metadataPath, original_bytes: current.bytes, snapshot: current };
}

function writeRegularFileAtomically(filePath, bytes, mode, options = {}) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
  if (options.expectedSnapshot) assertSnapshotCurrent(filePath, options.expectedSnapshot);
  const temp = path.join(parent, `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  let committed = false;
  try {
    fs.writeFileSync(temp, bytes, { mode: mode == null ? 0o600 : mode });
    if (mode != null && process.platform !== 'win32') fs.chmodSync(temp, mode);
    // Keep the comparison as close as possible to replacement. This cannot be
    // a cross-platform compare-and-swap, so uncertainty always aborts first.
    if (options.expectedSnapshot) assertSnapshotCurrent(filePath, options.expectedSnapshot);
    fs.renameSync(temp, filePath);
    committed = true;
    if (typeof options.afterReplace === 'function') options.afterReplace({ filePath, bytes: Buffer.from(bytes), mode });
    return { committed: true };
  } catch (error) {
    if (committed) error.atomicReplacementCommitted = true;
    throw error;
  } finally {
    try { fs.rmSync(temp, { force: true }); } catch {}
  }
}

function lstatRequired(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link.`);
  return stat;
}

function requireDirectory(filePath, label) {
  if (!lstatRequired(filePath, label).isDirectory()) throw new Error(`${label} must be a directory.`);
}

function requireRegularFile(filePath, label) {
  if (!lstatRequired(filePath, label).isFile()) throw new Error(`${label} must be a regular file.`);
}

function validateMetadataShape(metadata, generation, expectedConfigPath) {
  if (!metadata || metadata.schema !== BACKUP_SCHEMA) throw new Error('Backup metadata schema is unsupported.');
  if (metadata.generation !== generation) throw new Error('Backup metadata generation does not match its directory.');
  if (!samePath(metadata.config_path || '', expectedConfigPath)) throw new Error('Backup metadata target does not match the current Codex config path.');
  if (typeof metadata.existed !== 'boolean') throw new Error('Backup metadata existence state is invalid.');
  if (!Number.isSafeInteger(metadata.original_size_bytes) || metadata.original_size_bytes < 0) throw new Error('Backup metadata original size is invalid.');
  if (!Number.isSafeInteger(metadata.replacement_size_bytes) || metadata.replacement_size_bytes < 0) throw new Error('Backup metadata replacement size is invalid.');
  if (!/^[a-f0-9]{64}$/i.test(String(metadata.replacement_sha256 || ''))) throw new Error('Backup metadata replacement hash is invalid.');
  if (metadata.existed) {
    if (metadata.file_type !== 'regular') throw new Error('Backup metadata does not describe a regular original file.');
    if (!Number.isSafeInteger(metadata.original_mode) || metadata.original_mode < 0 || metadata.original_mode > 0o7777) throw new Error('Backup metadata original mode is invalid.');
    if (!/^[a-f0-9]{64}$/i.test(String(metadata.original_sha256 || ''))) throw new Error('Backup metadata original hash is invalid.');
    if (!metadata.original_identity || typeof metadata.original_identity !== 'object') throw new Error('Backup metadata original identity is invalid.');
  } else if (metadata.file_type !== 'missing' || metadata.backup_path !== null || metadata.original_mode !== null || metadata.original_sha256 !== null || metadata.original_size_bytes !== 0 || metadata.original_identity !== null) {
    throw new Error('Backup metadata missing-file semantics are invalid.');
  }
}

function readBackupMetadata(metadataPath, options = {}) {
  const expectedConfigPath = path.resolve(options.configPath || codexConfigPath());
  const root = path.resolve(options.backupRoot || backupRoot(expectedConfigPath));
  const resolvedMetadataPath = path.resolve(metadataPath);
  if (!isInside(root, resolvedMetadataPath) || path.basename(resolvedMetadataPath) !== 'restore.json') {
    throw new Error('Backup metadata path must be a restore.json file inside the Toolkit Codex-delegation backup root.');
  }
  const generationPath = path.dirname(resolvedMetadataPath);
  if (!samePath(path.dirname(generationPath), root)) throw new Error('Backup metadata must be inside one direct backup generation directory.');
  requireDirectory(root, 'Toolkit Codex-delegation backup root');
  requireDirectory(generationPath, 'Toolkit Codex-delegation backup generation');
  requireRegularFile(resolvedMetadataPath, 'Backup metadata');
  const metadata = JSON.parse(fs.readFileSync(resolvedMetadataPath, 'utf8'));
  validateMetadataShape(metadata, path.basename(generationPath), expectedConfigPath);
  if (metadata.existed) {
    const expectedBackup = path.join(generationPath, 'config.toml.original');
    if (!metadata.backup_path || !samePath(metadata.backup_path, expectedBackup)) throw new Error('Backup metadata backup path must be the expected generation sibling.');
    requireRegularFile(expectedBackup, 'Backup file');
  }
  return { metadata, root, generationPath, metadataPath: resolvedMetadataPath, expectedConfigPath };
}

function restoreCodexDelegationBackup(metadataPath, options = {}) {
  const { metadata, expectedConfigPath } = readBackupMetadata(metadataPath, options);
  let current;
  try {
    current = captureCodexConfigSnapshot(expectedConfigPath);
  } catch (error) {
    throw new Error(`Current Codex config topology is unsupported for exact restore: ${error.message}`);
  }
  if (!current.existed || current.file_type !== 'regular' || current.size_bytes !== metadata.replacement_size_bytes || current.sha256 !== metadata.replacement_sha256) {
    throw new Error('Current Codex config no longer matches the Toolkit replacement; refusing to overwrite or delete it.');
  }
  if (!metadata.existed) {
    if (typeof options.beforeDelete === 'function') options.beforeDelete({ configPath: expectedConfigPath, metadata, current });
    assertSnapshotCurrent(expectedConfigPath, current, 'Codex config changed immediately before restore deletion; refusing to delete the concurrent file.');
    fs.unlinkSync(expectedConfigPath);
    return { status: 'restored', config_path: expectedConfigPath, removed_created_file: true, exact: true };
  }
  const bytes = fs.readFileSync(metadata.backup_path);
  if (bytes.length !== metadata.original_size_bytes || sha256(bytes) !== metadata.original_sha256) throw new Error('Backup bytes failed integrity verification.');
  writeRegularFileAtomically(expectedConfigPath, bytes, metadata.original_mode, { expectedSnapshot: current });
  const restored = fs.readFileSync(expectedConfigPath);
  if (!restored.equals(bytes)) throw new Error('Exact Codex config restoration failed.');
  return { status: 'restored', config_path: expectedConfigPath, removed_created_file: false, exact: true };
}

module.exports = {
  BACKUP_SCHEMA,
  writeJsonAtomically,
  captureCodexConfigSnapshot,
  snapshotsMatch,
  assertSnapshotCurrent,
  createCodexConfigBackup,
  writeRegularFileAtomically,
  readBackupMetadata,
  restoreCodexDelegationBackup,
};
