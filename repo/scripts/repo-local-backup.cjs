'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BACKUP_SCHEMA = 'ai-agent-toolkit.repo-local-backup.v1';
const CANONICAL_BACKUP_DIR = '_agent-toolkit-backups';
const LEGACY_BACKUP_DIR = '.agent-toolkit-backups';
const TRANSIENT_CLEANUP_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
const CLEANUP_RETRY_DELAYS_MS = Object.freeze([0, 10, 25, 50]);
const CLEANUP_ID_PATTERN = /^[a-f0-9]{24}$/;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('Backup file path must be a non-empty repository-relative path.');
  const slash = value.replace(/\\/g, '/');
  if (path.posix.isAbsolute(slash) || /^[A-Za-z]:/.test(slash)) throw new Error('Backup file path must be repository-relative.');
  const parts = slash.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Backup file path contains an unsafe path segment.');
  const firstSegment = parts[0].toLowerCase();
  if ([CANONICAL_BACKUP_DIR, LEGACY_BACKUP_DIR].includes(firstSegment)) {
    throw new Error('Affected file path must not target Toolkit backup evidence.');
  }
  return parts.join('/');
}

function requireRealDirectory(directory, label) {
  const resolved = path.resolve(directory);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a real directory.`);
  const real = fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved);
  if (!samePath(real, resolved)) throw new Error(`${label} must not resolve through a junction or symbolic link.`);
  return resolved;
}

function requireResolvedPayload(generationPath, relativePath) {
  const resolvedGeneration = requireRealDirectory(generationPath, 'Backup generation');
  const realGeneration = fs.realpathSync.native ? fs.realpathSync.native(resolvedGeneration) : fs.realpathSync(resolvedGeneration);
  const parts = relativePath.split('/');
  let cursor = resolvedGeneration;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    const stat = fs.lstatSync(cursor);
    const leaf = index === parts.length - 1;
    if (stat.isSymbolicLink() || (leaf ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error(`Backup payload ${leaf ? 'has an unsupported filesystem type' : 'ancestor must be a real directory'}.`);
    }
    const realCursor = fs.realpathSync.native ? fs.realpathSync.native(cursor) : fs.realpathSync(cursor);
    if (!samePath(realCursor, cursor) || (!samePath(realCursor, realGeneration) && !isInside(realGeneration, realCursor))) {
      throw new Error('Backup payload must remain inside its exact completed generation after filesystem resolution.');
    }
  }
  return cursor;
}

function repositoryIdentity(repoRoot) {
  return sha256(Buffer.from((process.platform === 'win32' ? repoRoot.toLowerCase() : repoRoot), 'utf8'));
}

function resolveRepoPath(repoRoot, relativePath, options = {}) {
  const normalized = normalizeRelativePath(relativePath);
  const target = path.resolve(repoRoot, ...normalized.split('/'));
  if (!isInside(repoRoot, target)) throw new Error('Backup file path escapes the intended repository.');
  let cursor = target;
  if (!options.targetMayExist) cursor = path.dirname(cursor);
  while (!samePath(cursor, repoRoot)) {
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error(`Repository path must not traverse a symbolic link: ${normalized}`);
      if (!samePath(cursor, target) && !stat.isDirectory()) throw new Error(`Repository path has a non-directory parent: ${normalized}`);
    }
    cursor = path.dirname(cursor);
  }
  return { normalized, target };
}

function lineEndingState(bytes) {
  if (!bytes.length) return 'none';
  const text = bytes.toString('utf8');
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(^|[^\r])\n/g) || []).length;
  if (crlf && lf) return 'mixed';
  if (crlf) return 'crlf';
  if (lf) return 'lf';
  return 'none';
}

function finalNewlineState(bytes) {
  return bytes.length ? bytes[bytes.length - 1] === 0x0a : false;
}

function fileMode(stat) {
  return process.platform === 'win32' ? null : stat.mode & 0o7777;
}

function captureFile(repoRoot, relativePath) {
  const { normalized, target } = resolveRepoPath(repoRoot, relativePath, { targetMayExist: true });
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { path: normalized, target, existed: false, bytes: Buffer.alloc(0), mode: null };
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Backup target must be a regular file or missing: ${normalized}`);
  return { path: normalized, target, existed: true, bytes: fs.readFileSync(target), mode: fileMode(stat) };
}

function captureDescriptor(capture) {
  return {
    existed: capture.existed,
    size_bytes: capture.existed ? capture.bytes.length : 0,
    sha256: capture.existed ? sha256(capture.bytes) : null,
    line_endings: capture.existed ? lineEndingState(capture.bytes) : 'missing',
    final_newline: capture.existed ? finalNewlineState(capture.bytes) : null,
    mode: capture.mode,
  };
}

function replacementDescriptor(change) {
  if (change.replacementExisted === false) return { existed: false, size_bytes: 0, sha256: null };
  if (!Buffer.isBuffer(change.replacementBytes) && typeof change.replacementBytes !== 'string') {
    throw new Error(`Replacement bytes are required for ${change.path}.`);
  }
  const bytes = Buffer.isBuffer(change.replacementBytes) ? Buffer.from(change.replacementBytes) : Buffer.from(change.replacementBytes, 'utf8');
  return { existed: true, size_bytes: bytes.length, sha256: sha256(bytes) };
}

function safeOperationName(value) {
  const operation = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(operation)) throw new Error('Backup operation must use lowercase letters, digits, and hyphens.');
  return operation;
}

function timestampToken(date) {
  const parsed = date instanceof Date ? new Date(date.getTime()) : new Date(date || Date.now());
  if (!Number.isFinite(parsed.getTime())) throw new Error('Backup timestamp is invalid.');
  return parsed.toISOString().replace(/[-:.]/g, '');
}

function allocateGeneration(root, operation, options = {}) {
  const nonce = options.nonce === undefined ? crypto.randomBytes(5).toString('hex') : String(options.nonce);
  if (!/^[a-z0-9]{1,32}$/.test(nonce)) throw new Error('Backup nonce is invalid.');
  const base = `${operation}-${timestampToken(options.timestamp)}-${nonce}`;
  for (let index = 0; index < 1000; index += 1) {
    const id = index === 0 ? base : `${base}-${String(index).padStart(3, '0')}`;
    const finalPath = path.join(root, id);
    const pendingPath = path.join(root, `.pending-${id}`);
    const incompletePath = path.join(root, `.incomplete-${id}`);
    if (![finalPath, pendingPath, incompletePath].some((candidate) => fs.existsSync(candidate))) return { id, finalPath, pendingPath, incompletePath };
  }
  throw new Error('Could not allocate a unique Toolkit backup generation.');
}

function writeExclusive(filePath, bytes, mode = 0o600) {
  fs.writeFileSync(filePath, bytes, { flag: 'wx', mode });
}

function createRepoLocalBackup(repoRoot, options = {}) {
  const root = requireRealDirectory(repoRoot, 'Repository root');
  const operation = safeOperationName(options.operation);
  if (!Array.isArray(options.changes) || options.changes.length === 0) throw new Error('At least one affected file is required.');
  const seen = new Set();
  const captures = options.changes.map((change) => {
    const capture = captureFile(root, change.path);
    if (seen.has(capture.path)) throw new Error(`Duplicate affected file: ${capture.path}`);
    seen.add(capture.path);
    const captureKind = change.capture === undefined ? 'full-file' : change.capture;
    if (!['full-file', 'managed-region'].includes(captureKind)) throw new Error(`Unsupported capture kind for ${capture.path}.`);
    return { capture, captureKind, replacement: replacementDescriptor(change) };
  });
  const backupRoot = path.join(root, CANONICAL_BACKUP_DIR);
  if (fs.existsSync(backupRoot)) {
    const stat = fs.lstatSync(backupRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Canonical Toolkit backup root must be a real directory.');
  } else {
    fs.mkdirSync(backupRoot, { mode: 0o700 });
  }
  const generation = allocateGeneration(backupRoot, operation, options);
  fs.mkdirSync(generation.pendingPath, { mode: 0o700 });
  fs.mkdirSync(path.join(generation.pendingPath, 'files'), { mode: 0o700 });
  try {
    const files = captures.map(({ capture, captureKind, replacement }, index) => {
      const backupPath = capture.existed ? `files/${String(index).padStart(4, '0')}.original` : null;
      if (backupPath) writeExclusive(path.join(generation.pendingPath, ...backupPath.split('/')), capture.bytes);
      if (typeof options.afterBackupFile === 'function') options.afterBackupFile({ index, path: capture.path });
      return {
        path: capture.path,
        capture: captureKind,
        original: captureDescriptor(capture),
        expected_replacement: replacement,
        backup_path: backupPath,
      };
    });
    const metadata = {
      schema: BACKUP_SCHEMA,
      generation: generation.id,
      created_at: new Date(options.timestamp || Date.now()).toISOString(),
      repository: { root: '.', identity_sha256: repositoryIdentity(root) },
      operation: { id: operation },
      files,
      retention: { automatic_deletion: false },
    };
    writeExclusive(path.join(generation.pendingPath, 'restore.json'), Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8'));
    fs.renameSync(generation.pendingPath, generation.finalPath);
    return { metadata, metadata_path: path.join(generation.finalPath, 'restore.json'), generation_path: generation.finalPath };
  } catch (error) {
    try { if (fs.existsSync(generation.pendingPath)) fs.renameSync(generation.pendingPath, generation.incompletePath); } catch {}
    throw error;
  }
}

function validateDescriptor(descriptor, existedLabel) {
  if (!descriptor || typeof descriptor.existed !== 'boolean') throw new Error(`${existedLabel} existence state is invalid.`);
  if (!Number.isSafeInteger(descriptor.size_bytes) || descriptor.size_bytes < 0) throw new Error(`${existedLabel} size is invalid.`);
  if (descriptor.existed) {
    if (!/^[a-f0-9]{64}$/.test(String(descriptor.sha256 || ''))) throw new Error(`${existedLabel} checksum is invalid.`);
  } else if (descriptor.size_bytes !== 0 || descriptor.sha256 !== null) throw new Error(`${existedLabel} missing-file state is invalid.`);
}

function readRepoLocalBackup(repoRoot, metadataPath) {
  const root = requireRealDirectory(repoRoot, 'Repository root');
  const backupRoot = path.join(root, CANONICAL_BACKUP_DIR);
  if (!fs.existsSync(backupRoot)) throw new Error('Canonical Toolkit backup root does not exist.');
  const resolvedMetadata = path.resolve(metadataPath);
  if (!isInside(backupRoot, resolvedMetadata) || path.basename(resolvedMetadata) !== 'restore.json') throw new Error('Restore metadata must be inside the canonical Toolkit backup root.');
  const generationPath = path.dirname(resolvedMetadata);
  if (!samePath(path.dirname(generationPath), backupRoot) || path.basename(generationPath).startsWith('.')) throw new Error('Restore metadata must belong to one completed direct backup generation.');
  requireRealDirectory(backupRoot, 'Backup root');
  requireRealDirectory(generationPath, 'Backup generation');
  const metadataStat = fs.lstatSync(resolvedMetadata);
  if (metadataStat.isSymbolicLink() || !metadataStat.isFile()) throw new Error('Restore metadata has an unsupported filesystem type.');
  const realMetadata = fs.realpathSync.native ? fs.realpathSync.native(resolvedMetadata) : fs.realpathSync(resolvedMetadata);
  if (!samePath(realMetadata, resolvedMetadata)) throw new Error('Restore metadata must not resolve through a junction or symbolic link.');
  let metadata;
  try { metadata = JSON.parse(fs.readFileSync(resolvedMetadata, 'utf8')); } catch { throw new Error('Restore metadata is not valid JSON.'); }
  if (!metadata || metadata.schema !== BACKUP_SCHEMA) throw new Error('Restore metadata schema is unsupported.');
  if (typeof metadata.created_at !== 'string' || !metadata.created_at.endsWith('Z') || !Number.isFinite(Date.parse(metadata.created_at))) throw new Error('Restore metadata timestamp is invalid.');
  if (!metadata.retention || metadata.retention.automatic_deletion !== false) throw new Error('Restore metadata retention contract is invalid.');
  if (metadata.generation !== path.basename(generationPath)) throw new Error('Restore metadata generation does not match its directory.');
  if (!metadata.repository || metadata.repository.root !== '.' || metadata.repository.identity_sha256 !== repositoryIdentity(root)) throw new Error('Restore metadata belongs to a different repository identity.');
  safeOperationName(metadata.operation && metadata.operation.id);
  if (!Array.isArray(metadata.files) || metadata.files.length === 0) throw new Error('Restore metadata affected-file list is invalid.');
  const seen = new Set();
  const files = metadata.files.map((entry, index) => {
    const resolved = resolveRepoPath(root, entry.path, { targetMayExist: true });
    if (seen.has(resolved.normalized)) throw new Error('Restore metadata contains duplicate file paths.');
    seen.add(resolved.normalized);
    if (!['full-file', 'managed-region'].includes(entry.capture)) throw new Error('Restore metadata capture kind is unsupported.');
    validateDescriptor(entry.original, 'Original file');
    if (entry.original.existed) {
      if (!['none', 'lf', 'crlf', 'mixed'].includes(entry.original.line_endings)) throw new Error('Original file line-ending state is invalid.');
      if (typeof entry.original.final_newline !== 'boolean') throw new Error('Original file final-newline state is invalid.');
      if (entry.original.mode !== null && (!Number.isSafeInteger(entry.original.mode) || entry.original.mode < 0 || entry.original.mode > 0o7777)) throw new Error('Original file mode is invalid.');
    } else if (entry.original.line_endings !== 'missing' || entry.original.final_newline !== null || entry.original.mode !== null) {
      throw new Error('Original missing-file formatting state is invalid.');
    }
    validateDescriptor(entry.expected_replacement, 'Expected replacement');
    let backupFile = null;
    if (entry.original.existed) {
      const expected = `files/${String(index).padStart(4, '0')}.original`;
      if (entry.backup_path !== expected) throw new Error('Restore metadata backup path is invalid.');
      backupFile = path.resolve(generationPath, ...entry.backup_path.split('/'));
      if (!isInside(generationPath, backupFile)) throw new Error('Restore metadata backup path escapes its generation.');
      backupFile = requireResolvedPayload(generationPath, entry.backup_path);
      const bytes = fs.readFileSync(backupFile);
      if (bytes.length !== entry.original.size_bytes || sha256(bytes) !== entry.original.sha256) throw new Error('Backup payload checksum does not match restore metadata.');
    } else if (entry.backup_path !== null) throw new Error('Missing original file must not have a backup payload.');
    return { entry, target: resolved.target, backupFile };
  });
  return { metadata, metadata_path: resolvedMetadata, generation_path: generationPath, repo_root: root, files };
}

function currentMatches(target, descriptor) {
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) { return Boolean(error && error.code === 'ENOENT' && !descriptor.existed); }
  if (!descriptor.existed || stat.isSymbolicLink() || !stat.isFile() || stat.size !== descriptor.size_bytes) return false;
  try {
    const real = fs.realpathSync.native ? fs.realpathSync.native(target) : fs.realpathSync(target);
    if (!samePath(real, target)) return false;
    const bytes = fs.readFileSync(target);
    return bytes.length === descriptor.size_bytes && sha256(bytes) === descriptor.sha256;
  } catch {
    return false;
  }
}

function targetStateMatches(inspected, file, descriptor) {
  try {
    const resolved = resolveRepoPath(inspected.repo_root, file.entry.path, { targetMayExist: true });
    if (!samePath(resolved.target, file.target)) return false;
    requireRealDirectory(path.dirname(file.target), 'Restore target parent');
    return currentMatches(file.target, descriptor);
  } catch {
    return false;
  }
}

function uniqueSibling(target, label) {
  return path.join(path.dirname(target), `.${path.basename(target)}.${label}-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
}

function cleanupId(value) {
  if (typeof value !== 'string' || !CLEANUP_ID_PATTERN.test(value)) {
    throw new Error('Cleanup ID must be exactly 24 lowercase hexadecimal characters.');
  }
  return value;
}

function rollbackPath(target, generationPath, id) {
  return path.join(path.dirname(target), `.${path.basename(target)}.${rollbackLabel(generationPath)}-${cleanupId(id)}`);
}

function pathEntryExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function waitForCleanupRetry(delayMs, options) {
  if (typeof options.waitForCleanupRetry === 'function') {
    options.waitForCleanupRetry(delayMs);
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function removePrivateTemp(filePath, options = {}, validateBeforeUnlink = null) {
  const unlinkFile = options.unlinkFile || fs.unlinkSync;
  for (let attempt = 0; attempt < CLEANUP_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      if (validateBeforeUnlink && !validateBeforeUnlink()) return false;
      unlinkFile(filePath);
      return true;
    } catch (error) {
      if (error && error.code === 'ENOENT') return true;
      const retryable = Boolean(error && TRANSIENT_CLEANUP_CODES.has(error.code));
      if (!retryable || attempt === CLEANUP_RETRY_DELAYS_MS.length - 1) return false;
      waitForCleanupRetry(CLEANUP_RETRY_DELAYS_MS[attempt + 1], options);
    }
  }
  return false;
}

function cleanupPreparedRestoreTemps(prepared, options = {}) {
  let residueCount = 0;
  for (const file of prepared) {
    if (file.restoreTemp && !removePrivateTemp(file.restoreTemp, options)) residueCount += 1;
  }
  return { complete: residueCount === 0, residueCount };
}

function rollbackLabel(generationPath) {
  return `toolkit-rollback-${sha256(Buffer.from(path.basename(generationPath), 'utf8')).slice(0, 12)}`;
}

function restoreResult(inspected, prepared, cleanup) {
  const common = {
    restored: true,
    exact: true,
    files: prepared.map((file) => file.entry.path),
    backup_retained: true,
    temporary_cleanup_complete: cleanup.complete,
    temporary_residue_detected: !cleanup.complete,
    temporary_residue_count: cleanup.residueCount,
    metadata_path: path.relative(inspected.repo_root, inspected.metadata_path).replace(/\\/g, '/'),
  };
  if (cleanup.complete) return { status: 'restored', ...common };
  return {
    status: 'cleanup-incomplete',
    ...common,
    cleanup_id: cleanup.cleanupId,
    remediation: 'Target restoration completed, but private temporary residue remains. Run the cleanup command for this metadata after the filesystem lock is released.',
  };
}

function restoreRepoLocalBackup(repoRoot, metadataPath, options = {}) {
  const inspected = readRepoLocalBackup(repoRoot, metadataPath);
  for (const file of inspected.files) {
    if (!currentMatches(file.target, file.entry.expected_replacement)) throw new Error(`Current file does not match the recorded Toolkit replacement: ${file.entry.path}`);
  }

  const transactionCleanupId = cleanupId(options.testCleanupId == null
    ? crypto.randomBytes(12).toString('hex')
    : options.testCleanupId);
  const prepared = [];
  try {
    for (let index = 0; index < inspected.files.length; index += 1) {
      const file = inspected.files[index];
      requireRealDirectory(path.dirname(file.target), 'Restore target parent');
      const preparedFile = {
        ...file,
        restoreTemp: file.entry.original.existed ? uniqueSibling(file.target, 'toolkit-restore') : null,
        rollbackTemp: rollbackPath(file.target, inspected.generation_path, transactionCleanupId),
        mutated: false,
      };
      prepared.push(preparedFile);
      if (pathEntryExists(preparedFile.rollbackTemp)) throw new Error('Restore rollback destination already exists.');
      if (preparedFile.restoreTemp) {
        const readBackupFile = options.readBackupFile || fs.readFileSync;
        const writeRestoreTemp = options.writeRestoreTemp || fs.writeFileSync;
        const beforeRead = requireResolvedPayload(inspected.generation_path, file.entry.backup_path);
        const originalBytes = readBackupFile(beforeRead);
        const afterRead = requireResolvedPayload(inspected.generation_path, file.entry.backup_path);
        if (!samePath(beforeRead, afterRead)) throw new Error('Backup payload changed during restore preparation.');
        if (!Buffer.isBuffer(originalBytes)
          || originalBytes.length !== file.entry.original.size_bytes
          || sha256(originalBytes) !== file.entry.original.sha256) {
          throw new Error('Prepared backup payload bytes do not match restore metadata.');
        }
        writeRestoreTemp(preparedFile.restoreTemp, originalBytes, { flag: 'wx', mode: file.entry.original.mode == null ? 0o600 : file.entry.original.mode });
      }
    }
  } catch {
    const cleanup = cleanupPreparedRestoreTemps(prepared, options);
    if (!cleanup.complete) throw new Error('Restore preparation failed and private temporary cleanup is incomplete.');
    throw new Error('Restore preparation failed before any target mutation.');
  }

  try {
    for (let index = 0; index < prepared.length; index += 1) {
      const file = prepared[index];
      if (typeof options.beforeTargetDisplacement === 'function') options.beforeTargetDisplacement({ index, path: file.entry.path });
      if (!targetStateMatches(inspected, file, file.entry.expected_replacement)) {
        throw new Error(`Restore target changed immediately before mutation: ${file.entry.path}`);
      }
      if (file.entry.expected_replacement.existed) {
        fs.renameSync(file.target, file.rollbackTemp);
        file.mutated = true;
        if (typeof options.afterTargetDisplaced === 'function') options.afterTargetDisplaced({ index, path: file.entry.path });
      }
      if (file.entry.original.existed) {
        fs.renameSync(file.restoreTemp, file.target);
        file.restoreTemp = null;
        file.mutated = true;
      }
      if (typeof options.afterTargetMutation === 'function') options.afterTargetMutation({ index, path: file.entry.path });
    }
    for (const file of prepared) {
      if (!currentMatches(file.target, file.entry.original)) throw new Error(`Exact restored bytes could not be verified: ${file.entry.path}`);
    }
    let residueCount = 0;
    for (const file of prepared) {
      if (!removePrivateTemp(file.rollbackTemp, options)) residueCount += 1;
    }
    return restoreResult(inspected, prepared, { complete: residueCount === 0, residueCount, cleanupId: transactionCleanupId });
  } catch (error) {
    const rollbackErrors = [];
    for (const file of [...prepared].reverse()) {
      try {
        if (!file.mutated) continue;
        let displaced = null;
        if (fs.existsSync(file.target)) {
          displaced = uniqueSibling(file.target, 'toolkit-failed-restore');
          fs.renameSync(file.target, displaced);
        }
        if (fs.existsSync(file.rollbackTemp)) fs.renameSync(file.rollbackTemp, file.target);
        if (displaced && !removePrivateTemp(displaced, options)) throw new Error('Private failed-restore temporary cleanup is incomplete.');
      } catch (rollbackError) { rollbackErrors.push(`${file.entry.path}: ${rollbackError.message}`); }
    }
    const cleanup = cleanupPreparedRestoreTemps(prepared, options);
    if (rollbackErrors.length || !cleanup.complete) throw new Error('Restore failed and exact rollback or private temporary cleanup is incomplete.');
    throw new Error(`Restore failed; exact prior target state was restored.`);
  }
}

function cleanupRepoLocalRestoreResidue(repoRoot, metadataPath, requestedCleanupId, options = {}) {
  const exactCleanupId = cleanupId(requestedCleanupId);
  const inspected = readRepoLocalBackup(repoRoot, metadataPath);
  for (const file of inspected.files) {
    if (!targetStateMatches(inspected, file, file.entry.original)) throw new Error(`Cleanup requires the verified restored target state: ${file.entry.path}`);
  }
  let foundCount = 0;
  let residueCount = 0;
  let targetDriftCount = 0;
  let candidateDriftCount = 0;
  for (const file of inspected.files) {
    if (!file.entry.expected_replacement.existed) continue;
    const candidate = rollbackPath(file.target, inspected.generation_path, exactCleanupId);
    if (!pathEntryExists(candidate)) continue;
    foundCount += 1;
    if (typeof options.beforeCleanupCandidateDelete === 'function') options.beforeCleanupCandidateDelete({ path: file.entry.path });
    let targetDrifted = false;
    let candidateDrifted = false;
    const validateDeletion = () => {
      const targetValid = targetStateMatches(inspected, file, file.entry.original);
      const candidateValid = currentMatches(candidate, file.entry.expected_replacement);
      targetDrifted ||= !targetValid;
      candidateDrifted ||= !candidateValid;
      return targetValid && candidateValid;
    };
    if (!removePrivateTemp(candidate, options, validateDeletion)) residueCount += 1;
    if (targetDrifted) targetDriftCount += 1;
    if (candidateDrifted) candidateDriftCount += 1;
  }
  if (foundCount === 0) {
    return { status: 'cleanup-not-found', restored: true, backup_retained: true, temporary_cleanup_complete: false, temporary_residue_detected: false, temporary_residue_count: 0 };
  }
  if (residueCount === 0) {
    return { status: 'cleanup-complete', restored: true, backup_retained: true, temporary_cleanup_complete: true, temporary_residue_detected: false, temporary_residue_count: 0 };
  }
  return {
    status: 'cleanup-incomplete',
    restored: targetDriftCount === 0,
    backup_retained: true,
    temporary_cleanup_complete: false,
    temporary_residue_detected: true,
    temporary_residue_count: residueCount,
    target_drift_detected: targetDriftCount > 0,
    candidate_drift_detected: candidateDriftCount > 0,
    cleanup_id: exactCleanupId,
    remediation: targetDriftCount || candidateDriftCount
      ? 'Target or recovery residue state changed before cleanup. Preserve both entries and inspect the repository before retrying.'
      : 'Private temporary residue remains. Retry cleanup after the filesystem lock is released.',
  };
}

function inspectRepoLocalBackup(repoRoot, metadataPath) {
  const inspected = readRepoLocalBackup(repoRoot, metadataPath);
  return {
    schema: inspected.metadata.schema,
    generation: inspected.metadata.generation,
    created_at: inspected.metadata.created_at,
    operation: inspected.metadata.operation.id,
    files: inspected.metadata.files.map((entry) => ({ path: entry.path, capture: entry.capture, original: entry.original, expected_replacement: entry.expected_replacement })),
    restore: { supported: true, backup_retained_after_restore: true },
  };
}

function parseArgs(argv) {
  const args = { command: argv[2] };
  for (let index = 3; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--repo') args.repo = argv[++index];
    else if (value === '--metadata') args.metadata = argv[++index];
    else if (value === '--cleanup-id') args.cleanupId = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function main(argv = process.argv, options = {}) {
  const args = parseArgs(argv);
  if (!args.repo || !args.metadata) throw new Error('Usage: repo-local-backup.cjs inspect|restore|cleanup --repo <path> --metadata <restore.json>');
  const metadataPath = path.isAbsolute(args.metadata) ? args.metadata : path.resolve(args.repo, args.metadata);
  let result;
  if (args.command === 'inspect') result = inspectRepoLocalBackup(args.repo, metadataPath);
  else if (args.command === 'restore') result = restoreRepoLocalBackup(args.repo, metadataPath, options);
  else if (args.command === 'cleanup') result = cleanupRepoLocalRestoreResidue(args.repo, metadataPath, args.cleanupId, options);
  else throw new Error('Usage: repo-local-backup.cjs inspect|restore|cleanup --repo <path> --metadata <restore.json>');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'cleanup-incomplete' || result.status === 'cleanup-not-found') process.exitCode = 2;
  return result;
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`FAIL: ${error.message}\n`); process.exitCode = 1; }
}
module.exports = {
  BACKUP_SCHEMA,
  CANONICAL_BACKUP_DIR,
  LEGACY_BACKUP_DIR,
  sha256,
  normalizeRelativePath,
  lineEndingState,
  finalNewlineState,
  createRepoLocalBackup,
  readRepoLocalBackup,
  inspectRepoLocalBackup,
  restoreRepoLocalBackup,
  cleanupRepoLocalRestoreResidue,
  main,
};
