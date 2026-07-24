const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  canonicalWorkflowForGit,
  canonicaliseExport,
  mergeCredentialDeclarationDocument,
  selectWorkflowEntry,
  validatePortableDocument,
} = require('./n8n-portable-workflow.cjs');
const { writeReport } = require('./n8n-workflow-operation-report.cjs');

function usage() {
  console.error('Usage: node scripts/sync-n8n-live-exports.cjs <exports-dir> <workflow-dir> [bindings.json] [--credentials-only] [--allow-missing-exports] [--preserve-tags] [--create-missing-workflows] [--sync-exported-only] [--portable-credentials=file] [--deployment-policy=file] [--reviewed-source-update]');
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function readWorkflow(filePath) {
  const raw = readJson(filePath);
  return Array.isArray(raw) ? raw[0] : raw.workflow || raw;
}

function readDeploymentPolicy(filePath, options = {}) {
  const required = options.required === true;
  if (!filePath || !fs.existsSync(filePath)) {
    if (required) {
      const error = new Error('An explicitly configured deployment policy is unavailable.');
      error.code = 'N8N_POLICY_VALIDATION_FAILED';
      throw error;
    }
    return undefined;
  }
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    const error = new Error('The configured deployment policy could not be inspected safely.');
    error.code = 'N8N_POLICY_VALIDATION_FAILED';
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    const error = new Error('The configured deployment policy must be a regular file.');
    error.code = 'N8N_POLICY_VALIDATION_FAILED';
    throw error;
  }
  if (typeof options.beforeRead === 'function') options.beforeRead();
  try {
    return readJson(filePath);
  } catch {
    const error = new Error('The configured deployment policy could not be read as JSON.');
    error.code = 'N8N_POLICY_VALIDATION_FAILED';
    throw error;
  }
}

function stripLiveOnlyFields(workflow, options = {}) {
  return canonicalWorkflowForGit(workflow, options);
}

function credentialBindings(workflow) {
  return (workflow.nodes || [])
    .filter((node) => node.credentials)
    .map((node) => ({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      credentials: node.credentials,
    }));
}

function relativePath(filePath) {
  return path.relative(process.cwd(), filePath).split(path.sep).join('/') || '.';
}

function displayPath(filePath) {
  return path.relative(process.cwd(), filePath) || '.';
}

function comparablePath(filePath) {
  const resolved = path.normalize(path.resolve(filePath)).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertStrictChild(rootPath, targetPath, label) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must remain a strict child of the workflow directory.`);
  }
  let current = target;
  while (true) {
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || comparablePath(fs.realpathSync.native(current)) !== comparablePath(current)) {
        throw new Error(`${label} contains a symlink, junction, or reparse escape.`);
      }
    }
    if (comparablePath(current) === comparablePath(root)) break;
    current = path.dirname(current);
  }
  return target;
}

function transactionError(message, cause, code = 'N8N_INTERNAL_ERROR', recoveryState = 'not_required') {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.recoveryState = recoveryState;
  return error;
}

function transactionDriftError(message = 'Canonical transaction target drift was detected before safe replacement.') {
  return transactionError(message, undefined, 'N8N_CANONICAL_TRANSACTION_DRIFT', 'preserved');
}

function transactionPartialRecoveryError(cause) {
  return transactionError(
    'Canonical transaction stopped with bounded recovery evidence because exact rollback could not be proven safe.',
    cause,
    'N8N_CANONICAL_TRANSACTION_PARTIAL_RECOVERY',
    'partial_preserved'
  );
}

function transactionCommittedCleanupError(cause) {
  return transactionError(
    'Canonical transaction committed the complete candidate batch, but exact transaction-owned cleanup remains required.',
    cause,
    'N8N_CANONICAL_TRANSACTION_COMMITTED_CLEANUP_REQUIRED',
    'committed_cleanup_required'
  );
}

function transactionNoOverwriteUnavailableError(cause) {
  return transactionError(
    'Canonical transaction could not use the required no-overwrite candidate installation primitive.',
    cause,
    'N8N_CANONICAL_TRANSACTION_NO_OVERWRITE_UNAVAILABLE',
    'preserved'
  );
}

function assertRegularOrMissing(filePath, label) {
  if (!fs.existsSync(filePath)) return;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw transactionError(`${label} must be a regular file.`);
  }
}

const CANONICAL_NEW_FILE_MODE = 0o644;

function permissionMode(statMode) {
  return statMode & 0o777;
}

function applyDescriptorMode(descriptor, mode) {
  if (process.platform === 'win32') return;
  fs.fchmodSync(descriptor, mode);
}

function assertInstalledMode(filePath, mode) {
  if (process.platform === 'win32') return;
  if (permissionMode(fs.statSync(filePath).mode) !== mode) {
    throw transactionError('Canonical transaction replacement mode verification failed.');
  }
}

function bigintField(stat, nanosecondName, millisecondName) {
  if (typeof stat[nanosecondName] === 'bigint') return stat[nanosecondName].toString();
  const milliseconds = Number(stat[millisecondName]);
  return Number.isFinite(milliseconds) ? String(Math.trunc(milliseconds * 1e6)) : null;
}

function filesystemObjectId(stat) {
  const device = typeof stat.dev === 'bigint' ? stat.dev : BigInt(stat.dev || 0);
  const inode = typeof stat.ino === 'bigint' ? stat.ino : BigInt(stat.ino || 0);
  if (device === 0n || inode === 0n) return null;
  return `${device}:${inode}`;
}

function statIdentity(stat, options = {}) {
  return {
    type: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other',
    size: stat.size.toString(),
    mode: process.platform === 'win32' || options.directory === true
      ? null
      : permissionMode(Number(stat.mode)),
    mtimeNs: bigintField(stat, 'mtimeNs', 'mtimeMs'),
    ctimeNs: bigintField(stat, 'ctimeNs', 'ctimeMs'),
    birthtimeNs: bigintField(stat, 'birthtimeNs', 'birthtimeMs'),
    objectId: filesystemObjectId(stat),
  };
}

function safeLstat(filePath) {
  try {
    return fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw transactionDriftError('Canonical transaction filesystem identity could not be inspected safely.');
  }
}

function captureParentIdentity(filePath) {
  const parentPath = path.dirname(path.resolve(filePath));
  const stat = safeLstat(parentPath);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw transactionDriftError('Canonical transaction parent topology is no longer a safe directory.');
  }
  let realPath;
  try {
    realPath = fs.realpathSync.native(parentPath);
  } catch {
    throw transactionDriftError('Canonical transaction parent topology could not be resolved safely.');
  }
  if (comparablePath(realPath) !== comparablePath(parentPath)) {
    throw transactionDriftError('Canonical transaction parent topology contains a redirected path.');
  }
  const identity = statIdentity(stat, { directory: true });
  return {
    realPath: comparablePath(realPath),
    objectId: identity.objectId,
    type: identity.type,
  };
}

function sameParentIdentity(left, right) {
  return Boolean(
    left &&
    right &&
    left.type === 'directory' &&
    right.type === 'directory' &&
    left.realPath === right.realPath &&
    (left.objectId === null || right.objectId === null || left.objectId === right.objectId)
  );
}

function sameStatIdentity(left, right, options = {}) {
  if (!left || !right) return false;
  const fields = ['type', 'size', 'mode', 'mtimeNs', 'birthtimeNs'];
  if (options.ignoreCtime !== true) fields.push('ctimeNs');
  if (fields.some((field) => left[field] !== right[field])) return false;
  if (left.objectId !== null && right.objectId !== null && left.objectId !== right.objectId) return false;
  return true;
}

function captureCanonicalTargetIdentity(filePath) {
  const target = path.resolve(filePath);
  const parentBefore = captureParentIdentity(target);
  const entryBefore = safeLstat(target);
  if (!entryBefore) {
    const parentAfter = captureParentIdentity(target);
    if (!sameParentIdentity(parentBefore, parentAfter)) {
      throw transactionDriftError('Canonical transaction parent topology changed during identity capture.');
    }
    return {
      exists: false,
      realPath: comparablePath(target),
      parent: parentAfter,
    };
  }
  if (!entryBefore.isFile() || entryBefore.isSymbolicLink()) {
    throw transactionDriftError('Canonical transaction target is not a safe regular file.');
  }

  let realPathBefore;
  let descriptor;
  try {
    realPathBefore = fs.realpathSync.native(target);
    if (comparablePath(realPathBefore) !== comparablePath(target)) {
      throw transactionDriftError('Canonical transaction target contains a redirected path.');
    }
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow);
    const descriptorBefore = fs.fstatSync(descriptor, { bigint: true });
    if (!descriptorBefore.isFile() || !sameStatIdentity(statIdentity(entryBefore), statIdentity(descriptorBefore))) {
      throw transactionDriftError('Canonical transaction target changed before it could be read safely.');
    }
    const content = fs.readFileSync(descriptor);
    const descriptorAfter = fs.fstatSync(descriptor, { bigint: true });
    const entryAfter = safeLstat(target);
    const parentAfter = captureParentIdentity(target);
    const realPathAfter = fs.realpathSync.native(target);
    if (
      !entryAfter ||
      !entryAfter.isFile() ||
      entryAfter.isSymbolicLink() ||
      comparablePath(realPathAfter) !== comparablePath(target) ||
      !sameParentIdentity(parentBefore, parentAfter) ||
      !sameStatIdentity(statIdentity(descriptorBefore), statIdentity(descriptorAfter)) ||
      !sameStatIdentity(statIdentity(descriptorAfter), statIdentity(entryAfter))
    ) {
      throw transactionDriftError('Canonical transaction target changed during identity capture.');
    }
    const identity = statIdentity(descriptorAfter);
    return {
      exists: true,
      realPath: comparablePath(realPathAfter),
      parent: parentAfter,
      ...identity,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      content,
    };
  } catch (error) {
    if (error?.code === 'N8N_CANONICAL_TRANSACTION_DRIFT') throw error;
    throw transactionDriftError('Canonical transaction target could not be captured safely.');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function sameCanonicalIdentity(expected, current) {
  if (!expected || !current || expected.exists !== current.exists) return false;
  if (!sameParentIdentity(expected.parent, current.parent)) return false;
  if (!expected.exists) return expected.realPath === current.realPath;
  return (
    expected.realPath === current.realPath &&
    expected.sha256 === current.sha256 &&
    sameStatIdentity(expected, current)
  );
}

function assertCanonicalIdentity(expected, current, message) {
  if (!sameCanonicalIdentity(expected, current)) throw transactionDriftError(message);
}

function absentIdentityFor(record) {
  return absentIdentityAt(record.target, record.originalIdentity.parent);
}

function absentIdentityAt(filePath, parentIdentity) {
  return {
    exists: false,
    realPath: comparablePath(filePath),
    parent: parentIdentity,
  };
}

/*
 * Canonical transaction filesystem boundary matrix:
 *
 * - Existing target admission: open without following links, then bind the
 *   descriptor and pathname to the authorized object before any write.
 * - Existing target mutation: truncate/write/fsync/fchmod through that exact
 *   descriptor. No pathname rename, replacement, unlink, or copy is used.
 * - Missing target installation: O_CREAT | O_EXCL creates the destination
 *   without overwriting an entry that appears at the boundary.
 * - Precommit rollback: restore bytes and mode only through the same opened
 *   descriptor. If the pathname no longer names that object, preserve the
 *   external pathname state and report partial recovery.
 * - Stage/quarantine/finally cleanup: eliminated. Candidate validation occurs
 *   in memory before mutation, and no transaction-owned pathname needs unlink.
 *
 * Node does not expose an atomic compare-and-unlink or identity-bound rename.
 * This helper therefore never treats stat(path) followed by rm/rename as safe.
 */
const TRANSACTION_FILESYSTEM_AUDIT = Object.freeze([
  Object.freeze({ boundary: 'existing-target-admission', classification: 'identity-bound-open-descriptor' }),
  Object.freeze({ boundary: 'existing-target-mutation', classification: 'identity-bound-descriptor-write' }),
  Object.freeze({ boundary: 'missing-target-installation', classification: 'safe-no-overwrite-exclusive-create' }),
  Object.freeze({ boundary: 'precommit-rollback', classification: 'identity-bound-descriptor-write-or-partial-recovery' }),
  Object.freeze({ boundary: 'stage-cleanup', classification: 'eliminated-no-pathname' }),
  Object.freeze({ boundary: 'quarantine-transition', classification: 'eliminated-no-pathname' }),
  Object.freeze({ boundary: 'quarantine-cleanup', classification: 'eliminated-no-pathname' }),
  Object.freeze({ boundary: 'finally-cleanup', classification: 'eliminated-no-pathname' }),
]);

function readDescriptorContent(descriptor, size) {
  const length = Number(size);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw transactionDriftError('Canonical transaction descriptor size could not be represented safely.');
  }
  const content = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const bytesRead = fs.readSync(descriptor, content, offset, length - offset, offset);
    if (bytesRead <= 0) throw transactionDriftError('Canonical transaction descriptor could not be read completely.');
    offset += bytesRead;
  }
  return content;
}

function captureDescriptorIdentity(descriptor, filePath, parentIdentity) {
  const statBefore = fs.fstatSync(descriptor, { bigint: true });
  if (!statBefore.isFile()) {
    throw transactionDriftError('Canonical transaction descriptor is not a regular file.');
  }
  const content = readDescriptorContent(descriptor, statBefore.size);
  const statAfter = fs.fstatSync(descriptor, { bigint: true });
  if (!sameStatIdentity(statIdentity(statBefore), statIdentity(statAfter))) {
    throw transactionDriftError('Canonical transaction descriptor changed during identity capture.');
  }
  return {
    exists: true,
    realPath: comparablePath(filePath),
    parent: parentIdentity,
    ...statIdentity(statAfter),
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    content,
  };
}

function writeDescriptorContent(descriptor, content, mode) {
  fs.ftruncateSync(descriptor, 0);
  let offset = 0;
  while (offset < content.length) {
    const written = fs.writeSync(descriptor, content, offset, content.length - offset, offset);
    if (written <= 0) throw transactionError('Canonical transaction descriptor write did not make progress.');
    offset += written;
  }
  applyDescriptorMode(descriptor, mode);
  fs.fsyncSync(descriptor);
}

function openVerifiedExistingTarget(record, hooks, index) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let descriptor;
  try {
    descriptor = fs.openSync(record.target, fs.constants.O_RDWR | noFollow);
    const descriptorIdentity = captureDescriptorIdentity(
      descriptor,
      record.target,
      record.originalIdentity.parent
    );
    if (!sameCanonicalIdentity(record.originalIdentity, descriptorIdentity)) {
      throw transactionDriftError('Canonical transaction opened target did not match its authorized identity.');
    }
    const pathIdentity = captureCanonicalTargetIdentity(record.target);
    if (!sameCanonicalIdentity(descriptorIdentity, pathIdentity)) {
      throw transactionDriftError('Canonical transaction target changed while binding its descriptor.');
    }
    if (typeof hooks.afterExistingTargetIdentityProof === 'function') {
      hooks.afterExistingTargetIdentityProof(record, index);
    }
    const pathAfterHook = captureCanonicalTargetIdentity(record.target);
    if (!sameCanonicalIdentity(descriptorIdentity, pathAfterHook)) {
      throw transactionDriftError('Canonical transaction target changed after descriptor identity proof.');
    }
    record.targetDescriptor = descriptor;
    record.descriptorIdentity = descriptorIdentity;
    descriptor = undefined;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function installCandidateWithoutOverwrite(record, hooks, index) {
  if (typeof hooks.afterFinalTargetAbsence === 'function') {
    hooks.afterFinalTargetAbsence(record, index);
  }
  let descriptor;
  try {
    const openCandidate = typeof hooks.openCandidateNoOverwrite === 'function'
      ? hooks.openCandidateNoOverwrite
      : (target, mode) => fs.openSync(
        target,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR,
        mode
      );
    descriptor = openCandidate(record.target, record.installMode, record, index);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw transactionDriftError('Canonical transaction target appeared at the no-overwrite installation boundary.');
    }
    throw transactionNoOverwriteUnavailableError(error);
  }
  record.targetDescriptor = descriptor;
  descriptor = undefined;
  record.installed = true;
  record.mutatedByTransaction = true;
  const writeCandidate = typeof hooks.writeDescriptorContent === 'function'
    ? hooks.writeDescriptorContent
    : writeDescriptorContent;
  writeCandidate(record.targetDescriptor, record.content, record.installMode, record, index);
  record.descriptorIdentity = captureDescriptorIdentity(
    record.targetDescriptor,
    record.target,
    record.originalIdentity.parent
  );
  const installed = captureCanonicalTargetIdentity(record.target);
  if (!sameCanonicalIdentity(record.descriptorIdentity, installed)) {
    throw transactionDriftError('Canonical transaction candidate identity changed during exclusive installation.');
  }
  record.installedIdentity = installed;
}

function installCandidateThroughDescriptor(record, hooks, index) {
  if (typeof hooks.afterExistingTargetIdentityProofBeforeWrite === 'function') {
    hooks.afterExistingTargetIdentityProofBeforeWrite(record, index);
  }
  record.mutatedByTransaction = true;
  const writeCandidate = typeof hooks.writeDescriptorContent === 'function'
    ? hooks.writeDescriptorContent
    : writeDescriptorContent;
  writeCandidate(record.targetDescriptor, record.content, record.installMode, record, index);
  record.installed = true;
  const descriptorIdentity = captureDescriptorIdentity(
    record.targetDescriptor,
    record.target,
    record.originalIdentity.parent
  );
  const expectedHash = crypto.createHash('sha256').update(record.content).digest('hex');
  if (
    descriptorIdentity.sha256 !== expectedHash ||
    descriptorIdentity.size !== String(record.content.length) ||
    (process.platform !== 'win32' && descriptorIdentity.mode !== record.installMode) ||
    (
      record.originalIdentity.objectId !== null &&
      descriptorIdentity.objectId !== null &&
      record.originalIdentity.objectId !== descriptorIdentity.objectId
    )
  ) {
    throw transactionDriftError('Canonical transaction descriptor did not contain the intended candidate.');
  }
  record.descriptorIdentity = descriptorIdentity;
  const installed = captureCanonicalTargetIdentity(record.target);
  if (!sameCanonicalIdentity(descriptorIdentity, installed)) {
    throw transactionDriftError('Canonical transaction pathname changed during descriptor-bound installation.');
  }
  record.installedIdentity = installed;
}

function assertRecordPrecommitState(record) {
  assertCanonicalIdentity(
    record.installedIdentity,
    captureCanonicalTargetIdentity(record.target),
    'Canonical transaction candidate changed before commit.'
  );
  const descriptorCurrent = captureDescriptorIdentity(
    record.targetDescriptor,
    record.target,
    record.originalIdentity.parent
  );
  if (!sameCanonicalIdentity(record.installedIdentity, descriptorCurrent)) {
    throw transactionDriftError('Canonical transaction opened candidate changed before commit.');
  }
  if (record.originalExists) {
    if (
      record.originalSnapshot.sha256 !== record.originalIdentity.sha256 ||
      !record.originalSnapshot.content.equals(record.originalIdentity.content)
    ) {
      throw transactionDriftError('Canonical transaction original snapshot changed before commit.');
    }
  }
  const currentParent = captureParentIdentity(record.target);
  if (!sameParentIdentity(record.originalIdentity.parent, currentParent)) {
    throw transactionDriftError('Canonical transaction parent topology changed before commit.');
  }
}

function assertCommittedCandidateBatch(records) {
  for (const record of records) {
    const current = captureCanonicalTargetIdentity(record.target);
    if (!record.installedIdentity || !sameCanonicalIdentity(record.installedIdentity, current)) return false;
    if (process.platform !== 'win32' && current.mode !== record.installMode) return false;
    if (!sameParentIdentity(record.originalIdentity.parent, current.parent)) return false;
    record.installedIdentity = current;
  }
  return true;
}

function assertCompleteTransactionPostcondition(records) {
  for (const record of records) {
    assertCanonicalIdentity(
      record.installedIdentity,
      captureCanonicalTargetIdentity(record.target),
      'Canonical transaction final candidate postcondition failed.'
    );
    assertInstalledMode(record.target, record.installMode);
    const descriptorCurrent = captureDescriptorIdentity(
      record.targetDescriptor,
      record.target,
      record.originalIdentity.parent
    );
    if (!sameCanonicalIdentity(record.installedIdentity, descriptorCurrent)) {
      throw transactionPartialRecoveryError();
    }
  }
}

function rollbackTransaction(records, hooks) {
  let complete = true;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    try {
      if (!record.mutatedByTransaction) {
        continue;
      }
      // This capture is evidence only. It never authorizes pathname removal.
      // The restore below is bound to targetDescriptor even if a concurrent
      // actor replaces the canonical pathname after this proof.
      record.rollbackPathIdentity = captureCanonicalTargetIdentity(record.target);
      if (typeof hooks.afterRollbackIdentityProofBeforeDescriptorRestore === 'function') {
        hooks.afterRollbackIdentityProofBeforeDescriptorRestore(record, index);
      }
      if (!record.originalExists) {
        // Restoring exact absence would require pathname deletion. Preserve
        // the candidate and report partial recovery instead.
        complete = false;
        continue;
      }
      writeDescriptorContent(
        record.targetDescriptor,
        record.originalSnapshot.content,
        record.originalMode
      );
      record.installed = false;
      const restoredDescriptor = captureDescriptorIdentity(
        record.targetDescriptor,
        record.target,
        record.originalIdentity.parent
      );
      const pathCurrent = captureCanonicalTargetIdentity(record.target);
      const sameObject = (
        record.originalIdentity.objectId === null ||
        restoredDescriptor.objectId === null ||
        record.originalIdentity.objectId === restoredDescriptor.objectId
      );
      const restoredContent = (
        restoredDescriptor.sha256 === record.originalIdentity.sha256 &&
        restoredDescriptor.size === record.originalIdentity.size &&
        sameObject &&
        (process.platform === 'win32' || restoredDescriptor.mode === record.originalMode)
      );
      if (!restoredContent || !sameCanonicalIdentity(restoredDescriptor, pathCurrent)) {
        complete = false;
      }
      // Descriptor-bound restore changes host-managed timestamps. It is safe
      // for bytes/mode/object identity but cannot claim the original complete
      // metadata identity, so any post-mutation rollback remains partial.
      complete = false;
    } catch {
      complete = false;
    }
  }
  return complete;
}

function replaceFilesTransactionally(changes, hooks = {}) {
  if (!Array.isArray(changes) || changes.length === 0) return;
  const foldedTargets = new Map();
  const resolvedTargets = changes.map((change) => path.resolve(change.targetPath));
  for (const target of resolvedTargets) {
    const folded = target.toLowerCase();
    if (foldedTargets.has(folded)) {
      const error = new Error('Duplicate or case-folded canonical transaction target blocks export.');
      error.code = 'N8N_WORKFLOW_MATCH_AMBIGUOUS';
      throw error;
    }
    foldedTargets.set(folded, target);
    assertRegularOrMissing(target, 'Canonical transaction target');
  }
  const preparedChanges = changes.map((change) => {
    const content = Buffer.from(change.content, 'utf8');
    if (typeof change.validateContent === 'function') change.validateContent(content);
    return { ...change, content };
  });
  const records = changes.map((change, index) => {
    const target = resolvedTargets[index];
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const record = {
      ...preparedChanges[index],
      target,
      originalIdentity: captureCanonicalTargetIdentity(target),
      originalExists: false,
      originalSnapshot: null,
      originalMode: null,
      installMode: CANONICAL_NEW_FILE_MODE,
      targetDescriptor: null,
      descriptorIdentity: null,
      installedIdentity: null,
      installed: false,
      mutatedByTransaction: false,
      phase: 'PREPARED',
    };
    record.originalExists = record.originalIdentity.exists;
    record.originalSnapshot = record.originalIdentity.exists
      ? {
        sha256: record.originalIdentity.sha256,
        content: Buffer.from(record.originalIdentity.content),
      }
      : null;
    record.originalMode = record.originalIdentity.mode;
    record.installMode = record.originalIdentity.exists ? record.originalIdentity.mode : CANONICAL_NEW_FILE_MODE;
    return record;
  });

  let failure = null;
  let recoveryIncomplete = false;
  let phase = 'PREPARED';
  try {
    phase = 'INSTALLING';
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      record.phase = phase;
      if (typeof hooks.beforeTargetRevalidate === 'function') {
        hooks.beforeTargetRevalidate(record, index);
      }
      const currentTarget = captureCanonicalTargetIdentity(record.target);
      assertCanonicalIdentity(
        record.originalIdentity,
        currentTarget,
        'Canonical transaction target changed after authorization.'
      );
      if (record.originalExists) {
        openVerifiedExistingTarget(record, hooks, index);
        installCandidateThroughDescriptor(record, hooks, index);
      } else {
        if (typeof hooks.beforeCandidateInstall === 'function') {
          hooks.beforeCandidateInstall(record, index);
        }
        assertCanonicalIdentity(
          absentIdentityFor(record),
          captureCanonicalTargetIdentity(record.target),
          'Canonical transaction target appeared before candidate installation.'
        );
        installCandidateWithoutOverwrite(record, hooks, index);
      }
      if (typeof hooks.beforeVerify === 'function') hooks.beforeVerify(record, index);
      const installedAfterHook = captureCanonicalTargetIdentity(record.target);
      if (!sameCanonicalIdentity(record.installedIdentity, installedAfterHook)) {
        throw transactionError('Canonical transaction replacement verification failed.');
      }
      if (typeof hooks.afterReplace === 'function') hooks.afterReplace(record, index);
    }

    phase = 'PRECOMMIT_VERIFIED';
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      record.phase = phase;
      assertRecordPrecommitState(record);
    }
    if (typeof hooks.afterPrecommitVerified === 'function') hooks.afterPrecommitVerified(records);
    for (const record of records) assertRecordPrecommitState(record);

    phase = 'COMMITTED';
    for (const record of records) record.phase = phase;
    if (typeof hooks.afterCommit === 'function') hooks.afterCommit(records);
    if (!assertCommittedCandidateBatch(records)) {
      throw transactionPartialRecoveryError();
    }

    phase = 'POST_COMMIT_CLEANUP';
    if (typeof hooks.beforeFinalPostcondition === 'function') hooks.beforeFinalPostcondition(records);
    assertCompleteTransactionPostcondition(records);
    phase = 'COMPLETE';
    for (const record of records) record.phase = phase;
  } catch (error) {
    failure = error;
    if (phase === 'COMMITTED' || phase === 'POST_COMMIT_CLEANUP' || phase === 'COMPLETE') {
      if (!assertCommittedCandidateBatch(records)) {
        failure = transactionPartialRecoveryError(error);
      } else if (error?.code !== 'N8N_CANONICAL_TRANSACTION_PARTIAL_RECOVERY') {
        failure = error?.code === 'N8N_CANONICAL_TRANSACTION_COMMITTED_CLEANUP_REQUIRED'
          ? error
          : transactionCommittedCleanupError(error);
      }
    } else {
      recoveryIncomplete = !rollbackTransaction(records, hooks);
    }
  } finally {
    for (const record of records) {
      if (record.targetDescriptor !== null) {
        try {
          fs.closeSync(record.targetDescriptor);
        } catch {
          recoveryIncomplete = true;
        }
        record.targetDescriptor = null;
      }
    }
  }
  if (recoveryIncomplete) throw transactionPartialRecoveryError(failure);
  if (failure) throw failure;
}

function writeStep(status, message) {
  console.log(`[${status.padEnd(7)}] ${message}`);
}

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const valueFor = (name) => {
    const prefix = `--${name}=`;
    const match = argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : '';
  };
  return {
    bindingsPath: positional[0] || path.join('.n8n-local', 'n8n-credential-bindings.json'),
    credentialsOnly: flags.has('--credentials-only'),
    allowMissingExports: flags.has('--allow-missing-exports'),
    preserveTags: flags.has('--preserve-tags'),
    createMissingWorkflows: flags.has('--create-missing-workflows'),
    syncExportedOnly: flags.has('--sync-exported-only'),
    portableCredentialsPath: valueFor('portable-credentials'),
    deploymentPolicyPath: valueFor('deployment-policy'),
    deploymentPolicyConfigured: argv.some((arg) => arg.startsWith('--deployment-policy=')),
    reviewedSourceUpdate: flags.has('--reviewed-source-update'),
  };
}

function listWorkflowFiles(workflowDir) {
  if (!fs.existsSync(workflowDir)) return [];
  return fs.readdirSync(workflowDir)
    .filter((fileName) => fileName.toLowerCase().endsWith('.json'))
    .sort()
    .map((fileName) => path.join(workflowDir, fileName));
}

function listExportFiles(exportsDir) {
  if (!fs.existsSync(exportsDir)) return [];
  return fs.readdirSync(exportsDir)
    .filter((fileName) => fileName.toLowerCase().endsWith('.live-export.json'))
    .sort()
    .map((fileName) => path.join(exportsDir, fileName));
}

function exportBaseName(exportFile) {
  return path.basename(exportFile).replace(/\.live-export\.json$/i, '');
}

function buildTargets(exportsDir, workflowDir, createMissingWorkflows, syncExportedOnly) {
  const targetsByBaseName = new Map();

  if (syncExportedOnly) {
    for (const exportFile of listExportFiles(exportsDir)) {
      const baseName = exportBaseName(exportFile);
      const workflowFile = path.join(workflowDir, `${baseName}.json`);
      if (!fs.existsSync(workflowFile) && !createMissingWorkflows) {
        throw new Error(`Live export ${exportFile} has no matching repo workflow file ${workflowFile}. Use --create-missing-workflows only when creating repo files is intended.`);
      }
      targetsByBaseName.set(baseName, {
        baseName,
        workflowFile,
        exportFile,
        isNewWorkflow: !fs.existsSync(workflowFile),
      });
    }
    return [...targetsByBaseName.values()].sort((left, right) => left.baseName.localeCompare(right.baseName));
  }

  for (const workflowFile of listWorkflowFiles(workflowDir)) {
    const baseName = path.basename(workflowFile, path.extname(workflowFile));
    targetsByBaseName.set(baseName, {
      baseName,
      workflowFile,
      exportFile: path.join(exportsDir, `${baseName}.live-export.json`),
      isNewWorkflow: false,
    });
  }

  if (createMissingWorkflows) {
    for (const exportFile of listExportFiles(exportsDir)) {
      const baseName = exportBaseName(exportFile);
      if (!targetsByBaseName.has(baseName)) {
        targetsByBaseName.set(baseName, {
          baseName,
          workflowFile: path.join(workflowDir, `${baseName}.json`),
          exportFile,
          isNewWorkflow: true,
        });
      }
    }
  }

  return [...targetsByBaseName.values()].sort((left, right) => left.baseName.localeCompare(right.baseName));
}

function main() {
  const exportsDir = process.argv[2];
  const workflowDir = process.argv[3];
  const options = parseArgs(process.argv.slice(4));

  if (!exportsDir || !workflowDir) usage();

  options.portableCredentialsPath = options.portableCredentialsPath || path.join(workflowDir, 'toolkit', 'portable-credentials.json');
  options.portableCredentialsPath = assertStrictChild(workflowDir, options.portableCredentialsPath, 'Portable credential declaration');
  if (options.deploymentPolicyConfigured && !options.deploymentPolicyPath) {
    const error = new Error('An explicitly configured deployment policy is unavailable.');
    error.code = 'N8N_POLICY_VALIDATION_FAILED';
    throw error;
  }
  options.deploymentPolicyPath = options.deploymentPolicyPath || path.join(workflowDir, 'toolkit', 'deployment-policy.json');
  const deploymentPolicy = readDeploymentPolicy(options.deploymentPolicyPath, {
    required: options.deploymentPolicyConfigured,
  });
  validatePortableDocument(deploymentPolicy, 'deployment-policy');
  if (options.createMissingWorkflows) {
    fs.mkdirSync(workflowDir, { recursive: true });
  }
  let portableCredentialDocument = fs.existsSync(options.portableCredentialsPath)
    ? readJson(options.portableCredentialsPath)
    : { schemaVersion: 1, workflows: [] };
  validatePortableDocument(portableCredentialDocument, 'credential-declarations');
  const receiptWorkflows = [];
  const pendingWorkflowWrites = [];

  const targets = buildTargets(exportsDir, workflowDir, options.createMissingWorkflows, options.syncExportedOnly);
  if (!targets.length) {
    throw new Error(`No workflow JSON files found in ${workflowDir}`);
  }

  console.log('');
  console.log('== Sync live exports ==');
  console.log(`Mode          : ${options.credentialsOnly ? 'Credentials only' : 'Workflow JSON + credentials'}`);
  console.log(`Workflows     : ${targets.length}`);
  console.log(`Exports dir   : ${displayPath(exportsDir)}`);
  console.log(`Workflow dir  : ${displayPath(workflowDir)}`);
  console.log(`Tags          : ${options.preserveTags ? 'Preserved' : 'Stripped'}`);
  console.log(`Targets       : ${options.syncExportedOnly ? 'Exported files only' : 'Workflow directory files'}`);
  console.log(`Credentials   : ${options.credentialsOnly ? 'Local refresh only' : displayPath(options.portableCredentialsPath)}`);
  console.log(`Source update : ${options.reviewedSourceUpdate ? 'Reviewed protected-path update enabled' : 'Canonical protected paths retained'}`);

  const bindings = {
    version: 2,
    updatedAt: new Date().toISOString(),
    workflowDir: relativePath(workflowDir),
    workflows: [],
    skippedWorkflows: [],
  };

  let totalCredentialBindings = 0;
  for (const target of targets) {
    if (!fs.existsSync(target.exportFile)) {
      if (options.credentialsOnly && options.allowMissingExports) {
        bindings.skippedWorkflows.push({
          workflowFile: relativePath(target.workflowFile),
          reason: 'Missing live export',
        });
        writeStep('SKIP', `${path.basename(target.workflowFile)} has no live export; credential refresh skipped.`);
        continue;
      }

      throw new Error(`Missing live export for ${target.workflowFile}: expected ${target.exportFile}`);
    }

    const repoWorkflow = fs.existsSync(target.workflowFile) ? readWorkflow(target.workflowFile) : null;
    const liveWorkflow = readWorkflow(target.exportFile);

    if (repoWorkflow?.id && liveWorkflow.id && repoWorkflow.id !== liveWorkflow.id) {
      if (repoWorkflow.name !== liveWorkflow.name) {
        throw new Error(`Live export ID mismatch for ${displayPath(target.workflowFile)}: repo has ${repoWorkflow.id}, export has ${liveWorkflow.id}, and names differ (${repoWorkflow.name} != ${liveWorkflow.name})`);
      }
      if (liveWorkflow.isArchived === true) {
        throw new Error(`Live export ID mismatch for ${displayPath(target.workflowFile)}: matching by name is not allowed for archived live workflow ${liveWorkflow.id}`);
      }
      writeStep('ID', `${path.basename(target.workflowFile)} repo ${repoWorkflow.id} -> live ${liveWorkflow.id}`);
    }

    const nodeBindings = credentialBindings(liveWorkflow);
    totalCredentialBindings += nodeBindings.length;
    bindings.workflows.push({
      workflowFile: relativePath(target.workflowFile),
      workflowId: liveWorkflow.id || '',
      workflowName: liveWorkflow.name || '',
      sourceUpdatedAt: liveWorkflow.updatedAt || '',
      nodes: nodeBindings,
    });

    if (options.credentialsOnly) {
      writeStep('CRED', `${path.basename(target.workflowFile)} captured ${nodeBindings.length} credential binding(s).`);
      continue;
    }

    const previousDeclaration = selectWorkflowEntry(
      portableCredentialDocument,
      liveWorkflow,
      target.workflowFile,
      'credential declaration',
      'credential-declarations'
    );
    const exportResult = canonicaliseExport({
      liveWorkflow,
      canonicalWorkflow: repoWorkflow,
      workflowFile: target.workflowFile,
      deploymentPolicy,
      previousDeclaration,
      preserveTags: options.preserveTags,
      reviewedSourceUpdate: options.reviewedSourceUpdate,
    });
    const cleanWorkflow = exportResult.workflow;
    receiptWorkflows.push({ workflowFile: relativePath(target.workflowFile), workflowName: cleanWorkflow.name || '' });
    portableCredentialDocument = mergeCredentialDeclarationDocument(portableCredentialDocument, exportResult.declaration);
    const previousSize = fs.existsSync(target.workflowFile) ? fs.statSync(target.workflowFile).size : 0;
    const targetPath = assertStrictChild(workflowDir, target.workflowFile, 'Canonical workflow');
    const content = JSON.stringify(cleanWorkflow, null, 2) + '\n';
    pendingWorkflowWrites.push({
      targetPath,
      content,
      previousSize,
      nextSize: Buffer.byteLength(content),
      isNewWorkflow: target.isNewWorkflow,
      declarationCount: exportResult.declaration.nodes.length,
      protectedChangeCount: exportResult.protectedChanges.length,
      validateContent(candidateContent) {
        const raw = JSON.parse(candidateContent.toString('utf8'));
        const verification = Array.isArray(raw) ? raw[0] : raw.workflow || raw;
        if (verification.active !== false) throw transactionError('Staged canonical workflow must remain inactive.');
      },
    });
  }
  if (!options.credentialsOnly) {
    const declarationContent = JSON.stringify(portableCredentialDocument, null, 2) + '\n';
    replaceFilesTransactionally([
      ...pendingWorkflowWrites,
      {
        targetPath: options.portableCredentialsPath,
        content: declarationContent,
        validateContent(candidateContent) {
          const parsed = JSON.parse(candidateContent.toString('utf8'));
          validatePortableDocument(parsed, 'credential-declarations', { allowAbsent: false });
        },
      },
    ]);
    for (const pending of pendingWorkflowWrites) {
      writeStep(
        pending.isNewWorkflow ? 'CREATE' : 'WRITE',
        `${path.basename(pending.targetPath)} ${pending.previousSize} -> ${pending.nextSize} bytes, active=false, portable credential requirement(s)=${pending.declarationCount}`
      );
      if (pending.protectedChangeCount > 0) {
        writeStep('PROTECT', `${path.basename(pending.targetPath)} retained ${pending.protectedChangeCount} canonical protected value(s); use --reviewed-source-update only for an intentional reviewed source change.`);
      }
    }
    writeStep('SAVE', `${displayPath(options.portableCredentialsPath)} portable credential declarations updated without target credential IDs.`);
  }

  fs.mkdirSync(path.dirname(options.bindingsPath), { recursive: true });
  fs.writeFileSync(options.bindingsPath, JSON.stringify(bindings, null, 2) + '\n');
  const bindingsSize = fs.statSync(options.bindingsPath).size;
  writeStep('SAVE', `${displayPath(options.bindingsPath)} ${bindingsSize} bytes, credential bindings=${totalCredentialBindings}, skipped=${bindings.skippedWorkflows.length}`);
  writeReport(path.join('.n8n-local', 'reports'), {
    operationType: options.credentialsOnly ? 'credential-metadata-refresh' : 'export',
    result: 'SUCCESS',
    code: 'N8N_EXPORT_SUCCESS',
    phase: 'receipt',
    workflows: receiptWorkflows,
    credentials: [],
    resources: [],
    mutation: { attempted: true, performed: true },
    activeState: 'inactive-canonical-source',
    executionState: 'not_executed',
    nextAction: { code: 'REVIEW_CANONICAL_DIFF', message: 'Review canonical workflow and portable declaration changes before committing.' },
    unchangedScope: ['activation', 'execution', 'credential values', 'exact local resource bindings'],
  });
  writeStep('REPORT', 'Sanitized export receipt written under .n8n-local/reports.');
}

if (require.main === module) {
  main();
}

module.exports = {
  stripLiveOnlyFields,
  credentialBindings,
  buildTargets,
  parseArgs,
  readDeploymentPolicy,
  assertStrictChild,
  replaceFilesTransactionally,
  TRANSACTION_FILESYSTEM_AUDIT,
  CANONICAL_NEW_FILE_MODE,
};
