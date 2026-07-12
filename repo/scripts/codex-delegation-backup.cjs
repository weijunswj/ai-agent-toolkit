'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { backupRoot, codexConfigPath, sha256 } = require('./codex-delegation-common.cjs');

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

function createCodexConfigBackup(configPath = codexConfigPath()) {
  let stat = null;
  let bytes = null;
  try {
    stat = fs.lstatSync(configPath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  if (stat && stat.isSymbolicLink()) throw new Error('Codex config is a symbolic link; backup and mutation are refused.');
  if (stat && !stat.isFile()) throw new Error('Codex config is not a regular file; backup and mutation are refused.');
  if (stat) bytes = fs.readFileSync(configPath);
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(6).toString('hex')}`;
  const root = path.join(backupRoot(), id);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const backupPath = stat ? path.join(root, 'config.toml.original') : null;
  if (stat) fs.writeFileSync(backupPath, bytes, { mode: 0o600 });
  const metadata = {
    schema: 'ai-agent-toolkit.codex-config-backup.v1',
    created_at: new Date().toISOString(),
    config_path: path.resolve(configPath),
    existed: Boolean(stat),
    file_type: stat ? 'regular' : 'missing',
    symlink_target: null,
    original_mode: stat ? (stat.mode & 0o7777) : null,
    original_size_bytes: stat ? bytes.length : 0,
    original_sha256: stat ? sha256(bytes) : null,
    backup_path: backupPath,
  };
  const metadataPath = path.join(root, 'restore.json');
  writeJsonAtomically(metadataPath, metadata, 0o600);
  return { ...metadata, metadata_path: metadataPath, original_bytes: bytes };
}

function writeRegularFileAtomically(filePath, bytes, mode) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
  const temp = path.join(parent, `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  try {
    fs.writeFileSync(temp, bytes, { mode: mode == null ? 0o600 : mode });
    if (mode != null && process.platform !== 'win32') fs.chmodSync(temp, mode);
    fs.renameSync(temp, filePath);
    if (mode != null && process.platform !== 'win32') fs.chmodSync(filePath, mode);
  } finally {
    try { fs.rmSync(temp, { force: true }); } catch {}
  }
}

function readBackupMetadata(metadataPath) {
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  if (!metadata || metadata.schema !== 'ai-agent-toolkit.codex-config-backup.v1') throw new Error('Backup metadata schema is unsupported.');
  if (!path.isAbsolute(metadata.config_path)) throw new Error('Backup metadata config path must be absolute.');
  return metadata;
}

function restoreCodexDelegationBackup(metadataPath) {
  const metadata = readBackupMetadata(metadataPath);
  const configPath = metadata.config_path;
  let current = null;
  try { current = fs.lstatSync(configPath); } catch (error) { if (!error || error.code !== 'ENOENT') throw error; }
  if (current && (current.isSymbolicLink() || !current.isFile())) throw new Error('Current Codex config topology is unsupported for exact restore.');
  if (!metadata.existed) {
    if (current) fs.rmSync(configPath);
    return { status: 'restored', config_path: configPath, removed_created_file: Boolean(current), exact: true };
  }
  if (metadata.file_type !== 'regular' || !metadata.backup_path) throw new Error('Backup metadata does not describe a restorable regular file.');
  const bytes = fs.readFileSync(metadata.backup_path);
  if (bytes.length !== metadata.original_size_bytes || sha256(bytes) !== metadata.original_sha256) throw new Error('Backup bytes failed integrity verification.');
  writeRegularFileAtomically(configPath, bytes, metadata.original_mode);
  const restored = fs.readFileSync(configPath);
  if (!restored.equals(bytes)) throw new Error('Exact Codex config restoration failed.');
  return { status: 'restored', config_path: configPath, removed_created_file: false, exact: true };
}

module.exports = { writeJsonAtomically, createCodexConfigBackup, writeRegularFileAtomically, readBackupMetadata, restoreCodexDelegationBackup };
