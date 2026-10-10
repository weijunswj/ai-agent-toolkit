'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const reviewState = require('../scripts/source-watch-review-state.cjs');
const sourceUpdates = require('../scripts/check-project-source-updates.cjs');
const { SPEC_SCHEMA, inspectOwnedTemps, recoverStaleOwnedTemps, withOwnedTemp } = require('../scripts/toolkit-owned-temp.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'repo', 'scripts', 'check-project-source-updates.cjs');
const sourceLockRel = 'repo/source-watch/provenance/example/SOURCE-LOCK.json';
const sourceProjectRel = 'repo/source-watch/provenance/example';
const lockedSha = '1111111111111111111111111111111111111111';
const latestSha = '2222222222222222222222222222222222222222';
const lifecycleTestName = 'source-update profile failure remains primary when owned-root cleanup is incomplete';
const lifecycleRoleEnv = 'AI_AGENT_TOOLKIT_W2A_G3_LIFECYCLE_ROLE';
const lifecycleRootEnv = 'AI_AGENT_TOOLKIT_W2A_G3_LIFECYCLE_ROOT';
const lifecycleReceiptEnv = 'AI_AGENT_TOOLKIT_W2A_G3_LIFECYCLE_RECEIPT';
const lifecycleClaimEnv = 'AI_AGENT_TOOLKIT_W2A_G3_LIFECYCLE_CLAIM';
const lifecycleOwnerEnv = 'AI_AGENT_TOOLKIT_W2A_G3_LIFECYCLE_OWNER_PID';
const lifecycleEvidenceDirEnv = 'AI_AGENT_TOOLKIT_W2A_G3_LIFECYCLE_EVIDENCE_DIR';
const lifecycleSentinel = 'w2a-g3-unrelated-preservation-sentinel';
const lifecycleNamespace = '.ai-agent-toolkit-owned-temp-v1';
const lifecycleRootMarker = '.ai-agent-toolkit-owned-temp-marker.json';
const lifecycleBudgetBytes = 16 * 1024 * 1024;
const lifecycleMetadataBytes = 1024 * 1024;

function lifecycleSha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function lifecycleStatIdentity(stats) {
  return { dev: String(stats.dev), ino: String(stats.ino), mode: String(stats.mode) };
}

function lifecycleFileSnapshot(filePath) {
  let stats;
  try { stats = fs.lstatSync(filePath, { bigint: true }); }
  catch (caught) {
    if (caught.code === 'ENOENT') return { path: filePath, exists: false };
    throw caught;
  }
  assert.ok(stats.isFile(), 'Lifecycle evidence path must be a regular file: ' + filePath);
  const bytes = fs.readFileSync(filePath);
  return {
    path: filePath,
    exists: true,
    identity: lifecycleStatIdentity(stats),
    size: Number(stats.size),
    mtimeNs: String(stats.mtimeNs),
    ctimeNs: String(stats.ctimeNs),
    sha256: lifecycleSha256(bytes)
  };
}

function lifecycleDirectorySnapshot(directoryPath) {
  let stats;
  try { stats = fs.lstatSync(directoryPath, { bigint: true }); }
  catch (caught) {
    if (caught.code === 'ENOENT') return { path: directoryPath, exists: false };
    throw caught;
  }
  assert.ok(stats.isDirectory() && !stats.isSymbolicLink(), 'Lifecycle directory must be a real directory: ' + directoryPath);
  const entries = fs.readdirSync(directoryPath).sort().map((name) => {
    const child = path.join(directoryPath, name);
    const childStats = fs.lstatSync(child, { bigint: true });
    if (childStats.isDirectory()) {
      assert.ok(!childStats.isSymbolicLink(), 'Lifecycle directory entry must not be a symlink: ' + child);
      return { name, type: 'directory', identity: lifecycleStatIdentity(childStats), entries: fs.readdirSync(child).sort() };
    }
    assert.ok(childStats.isFile(), 'Lifecycle directory entry must be a regular file: ' + child);
    const snapshot = lifecycleFileSnapshot(child);
    return { name, type: 'file', identity: snapshot.identity, size: snapshot.size, mtimeNs: snapshot.mtimeNs, ctimeNs: snapshot.ctimeNs, sha256: snapshot.sha256 };
  });
  return { path: directoryPath, exists: true, identity: lifecycleStatIdentity(stats), entries };
}

function lifecyclePaths(tempRoot, claimId) {
  const namespacePath = path.join(tempRoot, lifecycleNamespace);
  const claimsPath = path.join(namespacePath, 'claims');
  const rootsPath = path.join(namespacePath, 'roots');
  const claimPath = path.join(claimsPath, claimId + '.claim.json');
  const leasePath = path.join(claimsPath, claimId + '.lease.json');
  const markerPath = path.join(claimsPath, claimId + '.marker.json');
  const rootPath = path.join(rootsPath, 'root-' + claimId);
  return {
    tempRoot,
    namespacePath,
    namespaceMarkerPath: path.join(namespacePath, 'namespace.json'),
    claimsPath,
    rootsPath,
    claimPath,
    leasePath,
    markerPath,
    rootPath,
    rootMarkerPath: path.join(rootPath, lifecycleRootMarker),
    admissionLockPath: path.join(namespacePath, 'admission.lock.json'),
    sentinelPath: path.join(tempRoot, lifecycleSentinel)
  };
}

function captureLifecycleCustody(tempRoot, claimId) {
  const paths = lifecyclePaths(tempRoot, claimId);
  return {
    namespace: lifecycleDirectorySnapshot(paths.namespacePath),
    namespaceMarker: lifecycleFileSnapshot(paths.namespaceMarkerPath),
    claims: lifecycleDirectorySnapshot(paths.claimsPath),
    roots: lifecycleDirectorySnapshot(paths.rootsPath),
    admissionLock: lifecycleFileSnapshot(paths.admissionLockPath),
    claim: lifecycleFileSnapshot(paths.claimPath),
    lease: lifecycleFileSnapshot(paths.leasePath),
    outerMarker: lifecycleFileSnapshot(paths.markerPath),
    root: lifecycleDirectorySnapshot(paths.rootPath),
    rootMarker: lifecycleFileSnapshot(paths.rootMarkerPath),
    sentinel: lifecycleFileSnapshot(paths.sentinelPath)
  };
}

function readLifecycleResidue(tempRoot, claimId) {
  const paths = lifecyclePaths(tempRoot, claimId);
  const claimBytes = fs.readFileSync(paths.claimPath);
  const claim = JSON.parse(claimBytes.toString('utf8'));
  const lease = JSON.parse(fs.readFileSync(paths.leasePath, 'utf8'));
  const marker = JSON.parse(fs.readFileSync(paths.markerPath, 'utf8'));
  const root = fs.lstatSync(paths.rootPath, { bigint: true });
  const rootEntries = fs.readdirSync(paths.rootPath).sort();
  const inspection = inspectOwnedTemps();
  const custody = captureLifecycleCustody(tempRoot, claimId);
  assert.equal(claim.claim_id, claimId);
  assert.equal(claim.claim_path, paths.claimPath);
  assert.equal(claim.lease_path, paths.leasePath);
  assert.equal(claim.marker_path, paths.markerPath);
  assert.equal(claim.root_path, paths.rootPath);
  assert.equal(claim.namespace_path, paths.namespacePath);
  assert.equal(claim.process.pid, process.pid, 'The claim must name the actual owner process.');
  assert.deepEqual({ dev: custody.claim.identity.dev, ino: custody.claim.identity.ino }, claim.claim_identity);
  assert.deepEqual(lease.claim_identity, claim.claim_identity);
  assert.deepEqual(marker.claim_identity, claim.claim_identity);
  assert.deepEqual(marker.process, claim.process);
  assert.equal(marker.claim_id, claimId);
  assert.equal(marker.namespace_path, paths.namespacePath);
  assert.equal(marker.claim_path, paths.claimPath);
  assert.equal(marker.root_path, paths.rootPath);
  assert.equal(lease.status, 'CLEANUP_INCOMPLETE');
  assert.equal(lease.last_error_code, 'EIO');
  assert.equal(lease.root_removed, false);
  assert.equal(lease.root_marker_removed, true);
  assert.equal(lease.metadata_cleanup_phase, null);
  assert.equal(lease.retention, null);
  assert.deepEqual({ dev: String(root.dev), ino: String(root.ino) }, { dev: lease.root_identity.dev, ino: lease.root_identity.ino });
  assert.deepEqual({ dev: String(root.dev), ino: String(root.ino) }, { dev: marker.root_identity.dev, ino: marker.root_identity.ino });
  assert.deepEqual({ dev: String(root.dev), ino: String(root.ino) }, { dev: marker.root_marker.root_identity.dev, ino: marker.root_marker.root_identity.ino });
  assert.deepEqual(lease.marker_identity, {
    dev: custody.outerMarker.identity.dev,
    ino: custody.outerMarker.identity.ino
  });
  assert.deepEqual(marker.root_marker_identity, lease.root_marker_identity);
  assert.deepEqual(lease.owned_children, [], 'All tracked descendants must leave custody before residue capture.');
  assert.equal(claim.budget_bytes, lifecycleBudgetBytes);
  assert.equal(claim.metadata_bytes, lifecycleMetadataBytes);
  assert.equal(claim.reservation_bytes, lifecycleBudgetBytes + lifecycleMetadataBytes);
  assert.equal(lease.reservation_bytes, claim.reservation_bytes);
  assert.ok(Number.isSafeInteger(lease.bytes_reserved) && lease.bytes_reserved >= 0 && lease.bytes_reserved <= lifecycleBudgetBytes);
  assert.ok(Number.isSafeInteger(lease.entries) && lease.entries >= 0);
  assert.deepEqual(rootEntries, [], 'The real EIO must occur after workspace and root marker removal.');
  assert.ok(root.isDirectory());
  assert.equal(fs.existsSync(paths.rootMarkerPath), false);
  assert.equal(marker.root_marker.claim_id, claimId);
  assert.equal(marker.root_marker.root_path, paths.rootPath);
  assert.equal(marker.root_marker.namespace_id, claim.namespace_id);
  assert.deepEqual(marker.root_marker.repository, claim.repository);
  assert.equal(marker.root_marker.episode, claim.episode);
  assert.equal(marker.root_marker.run_id, claim.run_id);
  assert.equal(marker.root_marker.lock_id, claim.lock_id);
  assert.deepEqual(marker.root_marker.process, claim.process);
  const publicRecord = inspection.records.find((record) => record.claimId === claimId);
  assert.ok(publicRecord, 'The public inspection must retain the incomplete claim.');
  assert.equal(publicRecord.state, 'CLEANUP_INCOMPLETE');
  assert.equal(publicRecord.budgetBytes, lifecycleBudgetBytes);
  assert.equal(publicRecord.reservationBytes, lifecycleBudgetBytes + lifecycleMetadataBytes);
  assert.equal(publicRecord.bytesReserved, lease.bytes_reserved);
  assert.equal(publicRecord.retained, false);
  assert.equal(publicRecord.retentionExpiresAtMs, null);
  assert.equal(inspection.outstandingReservationsBytes, lifecycleBudgetBytes + lifecycleMetadataBytes);
  assert.equal(inspection.retainedRoots, 0);
  return {
    schema: 'ai-agent-toolkit.w2a-g3-lifecycle-residue.v1',
    ownerPid: process.pid,
    claimId,
    paths,
    claim,
    claimBytesBase64: claimBytes.toString('base64'),
    lease,
    outerMarker: marker,
    custody,
    accounting: inspection
  };
}

function lifecycleProcessIsAbsent(pid, label) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, label + ' PID must be a positive safe integer.');
  assert.throws(() => process.kill(pid, 0), (caught) => caught && caught.code === 'ESRCH', label + ' must be confirmed exited.');
}

function lifecycleProcessGroupIsAbsent(pid, label) {
  lifecycleProcessIsAbsent(pid, label + ' process');
  if (process.platform !== 'win32') {
    assert.throws(() => process.kill(-pid, 0), (caught) => caught && caught.code === 'ESRCH', label + ' process group must be extinct.');
  }
}

function writeLifecycleReceipt(receiptPath, value) {
  const body = Buffer.from(JSON.stringify(value));
  const digest = lifecycleSha256(body);
  const header = Buffer.from('W2A-G3-LIFECYCLE/1\n' + body.length + '\n' + digest + '\n');
  const trailer = Buffer.from('\nEND-W2A-G3-LIFECYCLE/1\n');
  const fd = fs.openSync(receiptPath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, Buffer.concat([header, body, trailer]));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readLifecycleReceipt(receiptPath) {
  const bytes = fs.readFileSync(receiptPath);
  const first = bytes.indexOf(0x0a);
  const second = bytes.indexOf(0x0a, first + 1);
  const third = bytes.indexOf(0x0a, second + 1);
  assert.ok(first > 0 && second > first && third > second, 'Lifecycle receipt header is incomplete.');
  assert.equal(bytes.subarray(0, first).toString('utf8'), 'W2A-G3-LIFECYCLE/1');
  const lengthText = bytes.subarray(first + 1, second).toString('ascii');
  assert.match(lengthText, /^\d+$/);
  const length = Number(lengthText);
  const digest = bytes.subarray(second + 1, third).toString('ascii');
  const bodyStart = third + 1;
  const bodyEnd = bodyStart + length;
  assert.equal(bytes.length, bodyEnd + Buffer.byteLength('\nEND-W2A-G3-LIFECYCLE/1\n'));
  assert.equal(bytes.subarray(bodyEnd).toString('utf8'), '\nEND-W2A-G3-LIFECYCLE/1\n');
  const body = bytes.subarray(bodyStart, bodyEnd);
  assert.equal(lifecycleSha256(body), digest, 'Lifecycle receipt digest must verify.');
  return JSON.parse(body.toString('utf8'));
}

function lifecycleNoEffectMonitor(tempRoot, claimId) {
  const paths = lifecyclePaths(tempRoot, claimId);
  const files = [paths.claimPath, paths.leasePath, paths.markerPath].map((value) => path.resolve(value));
  const root = path.resolve(paths.rootPath);
  const isProtected = (value) => {
    if (typeof value !== 'string' && !Buffer.isBuffer(value) && !(value instanceof URL)) return false;
    const resolved = path.resolve(String(value));
    const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    const fileMatch = files.some((filePath) => normalized === (process.platform === 'win32' ? filePath.toLowerCase() : filePath));
    const rootBase = process.platform === 'win32' ? root.toLowerCase() : root;
    return fileMatch || normalized === rootBase || normalized.startsWith(rootBase + path.sep);
  };
  const effects = [];
  const originals = {};
  const observe = (name, predicate, call) => function (...args) {
    const target = predicate(...args);
    const result = call.apply(this, args);
    if (target) effects.push({ operation: name, target: String(target) });
    return result;
  };
  const observeAsync = (name, predicate, call) => async function (...args) {
    const target = predicate(...args);
    const result = await call.apply(this, args);
    if (target) effects.push({ operation: name, target: String(target) });
    return result;
  };
  originals.openSync = fs.openSync;
  originals.writeFileSync = fs.writeFileSync;
  originals.truncateSync = fs.truncateSync;
  originals.renameSync = fs.renameSync;
  originals.unlinkSync = fs.unlinkSync;
  originals.rmdirSync = fs.rmdirSync;
  originals.mkdirSync = fs.mkdirSync;
  originals.copyFileSync = fs.copyFileSync;
  originals.promiseRename = fs.promises.rename;
  originals.promiseUnlink = fs.promises.unlink;
  originals.promiseMkdir = fs.promises.mkdir;
  originals.promiseRmdir = fs.promises.rmdir;
  originals.promiseRm = fs.promises.rm;
  originals.promiseWriteFile = fs.promises.writeFile;
  originals.promiseAppendFile = fs.promises.appendFile;
  originals.promiseTruncate = fs.promises.truncate;
  originals.promiseCopyFile = fs.promises.copyFile;
  originals.rmSync = fs.rmSync;
  originals.appendFileSync = fs.appendFileSync;
  originals.chmodSync = fs.chmodSync;
  originals.chownSync = fs.chownSync;
  originals.utimesSync = fs.utimesSync;
  const writeFlags = (flags) => typeof flags === 'number'
    ? Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND))
    : /[wax+]/.test(String(flags));
  fs.openSync = observe('openSync(write)', (filePath, flags) => writeFlags(flags) && isProtected(filePath) ? filePath : null, originals.openSync);
  fs.writeFileSync = observe('writeFileSync', (filePath) => isProtected(filePath) ? filePath : null, originals.writeFileSync);
  fs.truncateSync = observe('truncateSync', (filePath) => isProtected(filePath) ? filePath : null, originals.truncateSync);
  fs.renameSync = observe('renameSync', (from, to) => isProtected(from) ? from : isProtected(to) ? to : null, originals.renameSync);
  fs.unlinkSync = observe('unlinkSync', (filePath) => isProtected(filePath) ? filePath : null, originals.unlinkSync);
  fs.rmdirSync = observe('rmdirSync', (filePath) => isProtected(filePath) ? filePath : null, originals.rmdirSync);
  fs.mkdirSync = observe('mkdirSync', (filePath) => isProtected(filePath) ? filePath : null, originals.mkdirSync);
  fs.copyFileSync = observe('copyFileSync', (from, to) => isProtected(from) ? from : isProtected(to) ? to : null, originals.copyFileSync);
  fs.rmSync = observe('rmSync', (filePath) => isProtected(filePath) ? filePath : null, originals.rmSync);
  fs.appendFileSync = observe('appendFileSync', (filePath) => isProtected(filePath) ? filePath : null, originals.appendFileSync);
  fs.chmodSync = observe('chmodSync', (filePath) => isProtected(filePath) ? filePath : null, originals.chmodSync);
  fs.chownSync = observe('chownSync', (filePath) => isProtected(filePath) ? filePath : null, originals.chownSync);
  fs.utimesSync = observe('utimesSync', (filePath) => isProtected(filePath) ? filePath : null, originals.utimesSync);
  fs.promises.rename = observeAsync('promises.rename', (from, to) => isProtected(from) ? from : isProtected(to) ? to : null, originals.promiseRename);
  fs.promises.unlink = observeAsync('promises.unlink', (filePath) => isProtected(filePath) ? filePath : null, originals.promiseUnlink);
  fs.promises.mkdir = observeAsync('promises.mkdir', (filePath) => isProtected(filePath) ? filePath : null, originals.promiseMkdir);
  fs.promises.rmdir = observeAsync('promises.rmdir', (filePath) => isProtected(filePath) ? filePath : null, originals.promiseRmdir);
  fs.promises.rm = observeAsync('promises.rm', (filePath) => isProtected(filePath) ? filePath : null, originals.promiseRm);
  fs.promises.writeFile = observeAsync('promises.writeFile', (filePath) => isProtected(filePath) ? filePath : null, originals.promiseWriteFile);
  fs.promises.appendFile = observeAsync('promises.appendFile', (filePath) => isProtected(filePath) ? filePath : null, originals.promiseAppendFile);
  fs.promises.truncate = observeAsync('promises.truncate', (filePath) => isProtected(filePath) ? filePath : null, originals.promiseTruncate);
  fs.promises.copyFile = observeAsync('promises.copyFile', (from, to) => isProtected(from) ? from : isProtected(to) ? to : null, originals.promiseCopyFile);
  return {
    effects,
    restore() {
      fs.openSync = originals.openSync;
      fs.writeFileSync = originals.writeFileSync;
      fs.truncateSync = originals.truncateSync;
      fs.renameSync = originals.renameSync;
      fs.unlinkSync = originals.unlinkSync;
      fs.rmdirSync = originals.rmdirSync;
      fs.mkdirSync = originals.mkdirSync;
      fs.copyFileSync = originals.copyFileSync;
      fs.promises.rename = originals.promiseRename;
      fs.promises.unlink = originals.promiseUnlink;
      fs.promises.mkdir = originals.promiseMkdir;
      fs.promises.rmdir = originals.promiseRmdir;
      fs.promises.rm = originals.promiseRm;
      fs.promises.writeFile = originals.promiseWriteFile;
      fs.promises.appendFile = originals.promiseAppendFile;
      fs.promises.truncate = originals.promiseTruncate;
      fs.promises.copyFile = originals.promiseCopyFile;
      fs.rmSync = originals.rmSync;
      fs.appendFileSync = originals.appendFileSync;
      fs.chmodSync = originals.chmodSync;
      fs.chownSync = originals.chownSync;
      fs.utimesSync = originals.utimesSync;
    }
  };
}

function ownedSpec(episode, options = {}) {
  return { schema: SPEC_SCHEMA, purpose: 'source-update', repoRoot, episode, budgetBytes: 16 * 1024 * 1024, ...options };
}

async function writeJson(lease, workspace, relativePath, value) {
  await lease.writeFile(path.posix.join(workspace, relativePath), JSON.stringify(value, null, 2) + '\n');
}

function activeLock(sourceCommit = lockedSha) {
  return {
    source_repo: 'example-owner/example-repo',
    source_ref: 'main',
    source_commit: sourceCommit,
    source_lifecycle: 'active',
    source_role: 'third_party_attribution_source',
    source_update_policy: 'manual_review_required',
    public_attribution_required: true,
    files: [
      {
        mode: 'exact',
        source_path: 'src/data.csv',
        root_surface_path: 'skills/fixture/data.csv',
        source_blob_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      },
      {
        mode: 'adapted',
        source_path: 'src/tool.js',
        root_surface_path: 'skills/fixture/tool.js',
        source_blob_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        notes: 'Adapted for toolkit local-only execution.'
      },
      {
        mode: 'excluded',
        source_path: 'package.json',
        notes: 'Excluded from the toolkit subset.'
      }
    ]
  };
}

function retiredLock() {
  return {
    source_repo: 'example-owner/retired-source',
    source_ref: 'main',
    source_commit: 'retired-source-marker',
    source_lifecycle: 'retired_after_migration',
    source_role: 'migration_provenance_only',
    source_update_policy: 'none',
    public_attribution_required: false,
    files: []
  };
}

function reviewStateDoc(reviewedThroughSha) {
  return {
    schema_version: 1,
    policy: {
      cursor_advancement: 'human_advanced_only',
      runtime_updates: 'forbidden',
      adoption_and_review_are_distinct: true
    },
    records: [{
      target_key: 'source-lock:' + sourceProjectRel,
      target_kind: 'source_lock',
      repository: 'example-owner/example-repo',
      ref: 'main',
      source_lock_path: sourceLockRel,
      reviewed_through_sha: reviewedThroughSha,
      reviewed_at: '2026-07-30',
      disposition: 'READ_ONLY_REVIEW_REQUIRED',
      owning_tracker: '#315'
    }]
  };
}

function ownedTempUsage() {
  const snapshot = require('../scripts/toolkit-owned-temp.cjs').inspectOwnedTemps();
  return {
    records: snapshot.records.length,
    outstandingReservationsBytes: snapshot.outstandingReservationsBytes,
    retainedRoots: snapshot.retainedRoots
  };
}

async function withOwnedWorkspace(ownedSpec, callback) {
  const baseline = ownedTempUsage();
  const original = fs.statfsSync;
  fs.statfsSync = () => ({ bavail: 16n * 1024n * 1024n * 1024n, bsize: 1n });
  try {
    const value = await withOwnedTemp(ownedSpec, callback);
    assert.deepEqual(ownedTempUsage(), baseline);
    return value;
  } finally {
    fs.statfsSync = original;
  }
}

async function withWorkspace(episode, fn) {
  return withOwnedWorkspace(ownedSpec(episode), async (lease) => {
    await lease.mkdir('workspace');
    return fn(lease, 'workspace');
  });
}

async function waitForTestBarrier(target, label) {
  if (target && typeof target.waitForBarrier === 'function') return target.waitForBarrier(label);
  let timer;
  try {
    await Promise.race([
      target,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for ' + label + '.')), 60000); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withMockGitHub(sha, fn, status = 200) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ sha }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn('http://127.0.0.1:' + port, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runScript(lease, workspace, apiBaseUrl) {
  const originalBaseUrl = process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
  process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = apiBaseUrl;
  try {
    return await lease.runProfile('source-update');
  } catch (error) {
    if (error.code !== 'TEMP_CHILD_FAILED' || !Number.isSafeInteger(error.exitCode) || error.exitCode === 0) throw error;
    return { code: error.exitCode, stdout: error.stdout, stderr: error.stderr };
  } finally {
    if (originalBaseUrl === undefined) delete process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
    else process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = originalBaseUrl;
  }
}

async function runStandaloneScript(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, options);
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.once('error', (caught) => { clearTimeout(timer); reject(caught); });
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}
function encodeReportFrame(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function decodeReportIpcTestFrame(frame) {
  assert.ok(Buffer.isBuffer(frame));
  assert.ok(frame.length >= 5);
  assert.equal(frame.readUInt32BE(0), frame.length - 4);
  return JSON.parse(frame.subarray(4).toString('utf8'));
}

function replyReportIpc(ipc, message, handle = null) {
  ipc.emit('message', Buffer.isBuffer(message) ? message : encodeReportFrame(message), handle);
}

function fakeReportIpc(respond, options = {}) {
  const ipc = new EventEmitter();
  ipc.channel = {};
  ipc.connected = true;
  ipc.sent = [];
  ipc.send = (frame, callback) => {
    assert.ok(ipc.listenerCount('message') > 0, 'message observer must be installed before send');
    assert.ok(ipc.listenerCount('error') > 0, 'error observer must be installed before send');
    assert.ok(ipc.listenerCount('disconnect') > 0, 'disconnect observer must be installed before send');
    const message = decodeReportIpcTestFrame(frame);
    ipc.sent.push(message);
    queueMicrotask(() => {
      const sendError = options.sendErrorType === message.type ? new Error('injected IPC send failure') : null;
      if (callback) callback(sendError);
      if (!sendError && respond) respond(ipc, message);
    });
    return true;
  };
  return ipc;
}

function autoReportBroker(ipc, message) {
  if (message.type === 'BROKER_HELLO') {
    replyReportIpc(ipc, { version: 1, token: message.token, type: 'BROKER_READY' });
  } else if (message.type === 'PUT_REPORT' || message.type === 'REMOVE_REPORT') {
    replyReportIpc(ipc, { version: 1, token: message.token, acknowledged: true });
  }
}


function installParentIpcFault(stage, makeMessages) {
  const ChildProcess = require('node:child_process').ChildProcess;
  const originalEmit = ChildProcess.prototype.emit;
  const state = { injected: false, messages: 0 };
  const isSourceUpdateChild = (child) => Array.isArray(child.spawnargs)
    && child.spawnargs.some((argument) => String(argument).endsWith('check-project-source-updates.cjs'));
  const dispatch = (child, items) => {
    for (const item of items) {
      state.messages += 1;
      originalEmit.call(child, 'message', item.message, item.handle);
    }
  };
  ChildProcess.prototype.emit = function (event, ...args) {
    if (event !== 'message' || !isSourceUpdateChild(this) || !Buffer.isBuffer(args[0])) {
      return originalEmit.call(this, event, ...args);
    }
    let received;
    try { received = decodeReportIpcTestFrame(args[0]); }
    catch (_) { return originalEmit.call(this, event, ...args); }
    if (!state.injected && stage === 'admission' && received.type === 'BROKER_HELLO') {
      state.injected = true;
      dispatch(this, makeMessages(received));
      return true;
    }
    if (!state.injected && stage === 'terminal' && received.type === 'BROKER_READY_ACK') {
      const result = originalEmit.call(this, event, ...args);
      state.injected = true;
      dispatch(this, makeMessages(received));
      return result;
    }
    if (state.injected && (received.type === 'PUT_REPORT' || received.type === 'REMOVE_REPORT')) return true;
    return originalEmit.call(this, event, ...args);
  };
  return {
    state,
    restore() { ChildProcess.prototype.emit = originalEmit; }
  };
}

function forgedControl(type, token, version = 1) {
  return encodeReportFrame({ version, token, type });
}

function forgedTerminal(type, token, fields = {}) {
  return encodeReportFrame({ version: 1, token, type, ...fields });
}

test('owned report parent IPC broker rejects invalid admission and terminal messages', async (t) => {
  const wrongToken = (token) => token === '0'.repeat(48) ? '1'.repeat(48) : '0'.repeat(48);
  const admissionCases = [
    ['wrong admission token', (message) => [{ message: forgedControl('BROKER_HELLO', wrongToken(message.token)) }]],
    ['wrong admission version', (message) => [{ message: forgedControl('BROKER_HELLO', message.token, 2) }]],
    ['wrong admission phase', (message) => [{ message: forgedControl('BROKER_READY_ACK', message.token) }]],
    ['malformed admission frame', () => [{ message: Buffer.from([0, 0, 0, 5, 123]) }]],
    ['admission frame with transferred handle', (message) => [{ message: forgedControl('BROKER_HELLO', message.token), handle: {} }]]
  ].map(([name, makeMessages]) => ({ name, stage: 'admission', makeMessages, duplicate: false }));
  const terminalCases = [
    ['wrong terminal token', (message) => [{ message: forgedTerminal('REMOVE_REPORT', wrongToken(message.token)) }]],
    ['wrong terminal version', (message) => [{ message: encodeReportFrame({ version: 2, token: message.token, type: 'REMOVE_REPORT' }) }]],
    ['wrong terminal type', (message) => [{ message: forgedTerminal('DELETE_REPORT', message.token) }]],
    ['malformed terminal JSON', () => [{ message: Buffer.from([0, 0, 0, 1, 123]) }]],
    ['oversized terminal frame', () => {
      const message = Buffer.alloc(65536 * 6 + 1025);
      message.writeUInt32BE(message.length - 4, 0);
      return [{ message }];
    }],
    ['truncated terminal frame', () => {
      const message = Buffer.alloc(6);
      message.writeUInt32BE(10, 0);
      message[4] = 123;
      message[5] = 125;
      return [{ message }];
    }],
    ['concatenated terminal frames', (message) => {
      const frame = forgedTerminal('REMOVE_REPORT', message.token);
      return [{ message: Buffer.concat([frame, frame]) }];
    }],
    ['terminal frame with destination injection', (message) => [{
      message: encodeReportFrame({ version: 1, token: message.token, type: 'REMOVE_REPORT', destination: 'workspace/escape.md' })
    }]],
    ['terminal frame with staged identity injection', (message) => [{
      message: forgedTerminal('PUT_REPORT', message.token, { content: 'injected', staged_identity: { dev: '1', ino: '2' } })
    }]],
    ['terminal frame with transferred handle', (message) => [{ message: forgedTerminal('REMOVE_REPORT', message.token), handle: {} }]],
    ['duplicate terminal request', (message) => [
      { message: forgedTerminal('PUT_REPORT', message.token, { content: 'first accepted report' }) },
      { message: forgedTerminal('PUT_REPORT', message.token, { content: 'replayed report must not overwrite' }) }
    ], true]
  ].map(([name, makeMessages, duplicate = false]) => ({ name, stage: 'terminal', makeMessages, duplicate }));

  for (const scenario of [...admissionCases, ...terminalCases]) {
    await t.test(scenario.name, async () => {
      const episode = 'parent-ipc-' + scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const baseline = ownedTempUsage();
      let profileError = null;
      await assert.rejects(withOwnedWorkspace(ownedSpec(episode), async (lease) => {
        await writeJson(lease, 'workspace', sourceLockRel, activeLock());
        const destination = lease.path('workspace/repo/source-watch/reviews/active-third-party-updates.md');
        await lease.writeFile('workspace/repo/source-watch/reviews/active-third-party-updates.md', 'prior report');
        await withMockGitHub(latestSha, async (apiBaseUrl) => {
          const originalApiBaseUrl = process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
          process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = apiBaseUrl;
          const injector = installParentIpcFault(scenario.stage, scenario.makeMessages);
          const originalRename = fs.renameSync;
          let destinationRenames = 0;
          if (scenario.duplicate) {
            fs.renameSync = function (source, target, ...args) {
              if (path.resolve(target) === path.resolve(destination)) destinationRenames += 1;
              return originalRename.call(this, source, target, ...args);
            };
          }
          try {
            await assert.rejects(lease.runProfile('source-update'), (caught) => { profileError = caught; return caught.code === 'TEMP_CHILD_PROTOCOL'; });
            assert.equal(injector.state.injected, true);
            assert.ok(injector.state.messages >= 1);
            if (scenario.duplicate) {
              assert.equal(destinationRenames, 1, 'only the first terminal request may commit');
              assert.equal(fs.readFileSync(destination, 'utf8'), 'first accepted report');
            } else {
              assert.equal(fs.readFileSync(destination, 'utf8'), 'prior report', 'invalid IPC must not mutate the report');
            }
          } finally {
            fs.renameSync = originalRename;
            injector.restore();
            if (originalApiBaseUrl === undefined) delete process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
            else process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = originalApiBaseUrl;
          }
        });
      }), (caught) => {
        assert.strictEqual(caught, profileError);
        return caught.code === 'TEMP_CHILD_PROTOCOL';
      });
      assert.deepEqual(ownedTempUsage(), baseline);
    });
  }
});

test('owned report frames enforce the strict UTF-8 JSON and payload contract', async () => {
  const token = 'a'.repeat(48);
  let commits = 0;
  const commit = async () => { commits += 1; };
  const exact = sourceUpdates.ownedReportRequestFrame({ type: 'PUT_REPORT', content: 'x'.repeat(65536) }, token);
  assert.equal((await sourceUpdates.mediateOwnedReportFrame(exact, token, commit)), 'PUT_REPORT');
  assert.equal(commits, 1);

  const escaped = '\u0000'.repeat(65536);
  assert.equal(Buffer.byteLength(escaped, 'utf8'), 65536);
  const escapedFrame = sourceUpdates.ownedReportRequestFrame({ type: 'PUT_REPORT', content: escaped }, token);
  assert.equal((await sourceUpdates.mediateOwnedReportFrame(escapedFrame, token, commit)), 'PUT_REPORT');
  assert.ok(escapedFrame.length <= 394240);
  assert.equal(commits, 2);

  const over = encodeReportFrame({ version: 1, token, type: 'PUT_REPORT', content: 'x'.repeat(65537) });
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(over, token, commit), /65,536-byte/);
  const replay = sourceUpdates.ownedReportRequestFrame({ type: 'REMOVE_REPORT' }, 'b'.repeat(48));
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(replay, token, commit), /unsupported shape or destination/);
  const request = sourceUpdates.ownedReportRequestFrame({ type: 'REMOVE_REPORT' }, token);
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(Buffer.concat([request, request]), token, commit), /exactly one complete frame/);
  const wrongDestination = encodeReportFrame({ version: 1, token, type: 'REMOVE_REPORT', destination: 'foreign' });
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(wrongDestination, token, commit), /unsupported shape or destination/);
  const identityRebind = encodeReportFrame({
    version: 1, token, type: 'PUT_REPORT', content: 'replacement',
    staged_identity: { dev: 'same-device', ino: 'same-inode' }, digest: 'coherent-digest', acknowledged: true
  });
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(identityRebind, token, commit), /unsupported shape or destination/);
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(Buffer.from([0, 0, 0, 1, 123]), token, commit), /malformed JSON/);
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(Buffer.from([0, 0, 0, 1, 255]), token, commit), /valid UTF-8/);
  const truncated = Buffer.from(request);
  truncated[3] -= 1;
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(truncated, token, commit), /exactly one complete frame/);
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(Buffer.alloc(394241), token, commit), /missing or oversized/);
  assert.equal(commits, 2);
});

test('owned report IPC client completes framed admission, one terminal request, and application acknowledgement', async () => {
  const token = 'a'.repeat(48);
  const env = { TOOLKIT_OWNED_TEMP_MODE: 'source-update-v1', TOOLKIT_OWNED_TEMP_REPORT_TOKEN: token };
  const ipc = fakeReportIpc(autoReportBroker);
  const client = sourceUpdates.createOwnedReportIpcClient(ipc, env);
  try {
    assert.equal(sourceUpdates.hasOwnedReportIpc(ipc, env), true);
    await client.admit();
    assert.equal(client.phase, 'ADMITTED');
    assert.deepEqual(ipc.sent.map((message) => message.type), ['BROKER_HELLO', 'BROKER_READY_ACK']);
    assert.equal(await client.send({ type: 'REMOVE_REPORT' }), 'REMOVE_REPORT');
    assert.equal(client.phase, 'ACK_RECEIVED');
    assert.deepEqual(ipc.sent.map((message) => message.type), ['BROKER_HELLO', 'BROKER_READY_ACK', 'REMOVE_REPORT']);
  } finally {
    client.dispose();
  }
  assert.equal(ipc.listenerCount('message'), 0);
  assert.equal(ipc.listenerCount('error'), 0);
  assert.equal(ipc.listenerCount('disconnect'), 0);
});

test('owned report IPC client rejects missing, disconnected, unusable, or invalid per-profile transport', () => {
  const token = 'a'.repeat(48);
  const env = { TOOLKIT_OWNED_TEMP_MODE: 'source-update-v1', TOOLKIT_OWNED_TEMP_REPORT_TOKEN: token };
  assert.equal(sourceUpdates.hasOwnedReportIpc({}, env), false);
  assert.throws(() => sourceUpdates.createOwnedReportIpcClient({}, env), /IPC channel is missing or unusable/);
  const noSend = new EventEmitter();
  noSend.channel = {};
  noSend.connected = true;
  assert.throws(() => sourceUpdates.createOwnedReportIpcClient(noSend, env), /IPC channel is missing or unusable/);
  const disconnected = new EventEmitter();
  disconnected.channel = {};
  disconnected.connected = false;
  disconnected.send = () => {};
  assert.throws(() => sourceUpdates.createOwnedReportIpcClient(disconnected, env), /IPC channel is missing or unusable/);
  assert.throws(() => sourceUpdates.createOwnedReportIpcClient(fakeReportIpc(autoReportBroker), {
    ...env, TOOLKIT_OWNED_TEMP_REPORT_TOKEN: 'invalid'
  }), /token is invalid/);
  assert.throws(() => sourceUpdates.createOwnedReportIpcClient(fakeReportIpc(autoReportBroker), {
    ...env, TOOLKIT_OWNED_TEMP_MODE: 'unsupported'
  }), /mode is missing or unsupported/);
});

test('owned report IPC client rejects malformed admission, wrong token/version/phase, replay, and transferred handles', async (t) => {
  const token = 'a'.repeat(48);
  const env = { TOOLKIT_OWNED_TEMP_MODE: 'source-update-v1', TOOLKIT_OWNED_TEMP_REPORT_TOKEN: token };
  const cases = [
    ['wrong token', (ipc, message) => replyReportIpc(ipc, { version: 1, token: 'b'.repeat(48), type: 'BROKER_READY' }), /admission failed/],
    ['wrong version', (ipc, message) => replyReportIpc(ipc, { version: 2, token: message.token, type: 'BROKER_READY' }), /admission failed/],
    ['wrong phase', (ipc, message) => replyReportIpc(ipc, { version: 1, token: message.token, type: 'PUT_REPORT' }), /admission failed|unexpected admission phase/],
    ['malformed frame', (ipc) => replyReportIpc(ipc, Buffer.from([0, 0, 0, 5, 123])), /admission failed/],
    ['transferred handle', (ipc, message) => replyReportIpc(ipc, { version: 1, token: message.token, type: 'BROKER_READY' }, { unexpected: true }), /transferred an unexpected handle/]
  ];
  for (const [label, respond, expected] of cases) {
    await t.test(label, async () => {
      const ipc = fakeReportIpc(respond);
      const client = sourceUpdates.createOwnedReportIpcClient(ipc, env);
      try { await assert.rejects(client.admit(), expected); }
      finally { client.dispose(); }
    });
  }

  const replayIpc = fakeReportIpc(autoReportBroker);
  const replayClient = sourceUpdates.createOwnedReportIpcClient(replayIpc, env);
  try {
    await replayClient.admit();
    replyReportIpc(replayIpc, { version: 1, token, type: 'BROKER_READY' });
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(replayClient.send({ type: 'REMOVE_REPORT' }), /unexpected phase/);
  } finally {
    replayClient.dispose();
  }
});

test('owned report IPC send success is not application receipt and disconnect after request fails closed', async () => {
  const token = 'a'.repeat(48);
  const env = { TOOLKIT_OWNED_TEMP_MODE: 'source-update-v1', TOOLKIT_OWNED_TEMP_REPORT_TOKEN: token };
  const ipc = fakeReportIpc((target, message) => {
    if (message.type === 'BROKER_HELLO') {
      replyReportIpc(target, { version: 1, token: message.token, type: 'BROKER_READY' });
    }
  });
  const client = sourceUpdates.createOwnedReportIpcClient(ipc, env);
  try {
    await client.admit();
    let settled = false;
    const pending = client.send({ type: 'REMOVE_REPORT' }).finally(() => { settled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    ipc.connected = false;
    ipc.emit('disconnect');
    await assert.rejects(pending, /IPC channel disconnected/);
    assert.equal(settled, true);
  } finally {
    client.dispose();
  }
});

test('owned report IPC client rejects wrong or negative acknowledgement and request send failure', async (t) => {
  const token = 'a'.repeat(48);
  const env = { TOOLKIT_OWNED_TEMP_MODE: 'source-update-v1', TOOLKIT_OWNED_TEMP_REPORT_TOKEN: token };
  const cases = [
    ['wrong token', (ipc, message) => {
      if (message.type === 'BROKER_HELLO') replyReportIpc(ipc, { version: 1, token: message.token, type: 'BROKER_READY' });
      if (message.type === 'REMOVE_REPORT') replyReportIpc(ipc, { version: 1, token: 'b'.repeat(48), acknowledged: true });
    }, /acknowledgement is invalid/],
    ['wrong version', (ipc, message) => {
      if (message.type === 'BROKER_HELLO') replyReportIpc(ipc, { version: 1, token: message.token, type: 'BROKER_READY' });
      if (message.type === 'REMOVE_REPORT') replyReportIpc(ipc, { version: 2, token: message.token, acknowledged: true });
    }, /acknowledgement is invalid/],
    ['unexpected acknowledgement key', (ipc, message) => {
      if (message.type === 'BROKER_HELLO') replyReportIpc(ipc, { version: 1, token: message.token, type: 'BROKER_READY' });
      if (message.type === 'REMOVE_REPORT') replyReportIpc(ipc, { version: 1, token: message.token, acknowledged: true, staged_identity: {} });
    }, /acknowledgement is invalid/],
    ['negative acknowledgement', (ipc, message) => {
      if (message.type === 'BROKER_HELLO') replyReportIpc(ipc, { version: 1, token: message.token, type: 'BROKER_READY' });
      if (message.type === 'REMOVE_REPORT') replyReportIpc(ipc, { version: 1, token: message.token, acknowledged: false });
    }, /rejected by the parent/]
  ];
  for (const [label, respond, expected] of cases) {
    await t.test(label, async () => {
      const ipc = fakeReportIpc(respond);
      const client = sourceUpdates.createOwnedReportIpcClient(ipc, env);
      try {
        await client.admit();
        await assert.rejects(client.send({ type: 'REMOVE_REPORT' }), expected);
      } finally { client.dispose(); }
    });
  }

  const failed = fakeReportIpc(autoReportBroker, { sendErrorType: 'REMOVE_REPORT' });
  const failedClient = sourceUpdates.createOwnedReportIpcClient(failed, env);
  try {
    await failedClient.admit();
    await assert.rejects(failedClient.send({ type: 'REMOVE_REPORT' }), /Owned report request failed/);
  } finally {
    failedClient.dispose();
  }
});

test('owned mode without IPC fails admission before any standalone report write', async () => {
  const token = 'a'.repeat(48);
  await withWorkspace('owned-report-missing-ipc', async (lease, workspace) => {
    const result = spawnSync(process.execPath, [
      scriptPath, '--workspace', lease.path(workspace), '--report', 'must-not-write.md'
    ], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, TOOLKIT_OWNED_TEMP_MODE: 'source-update-v1', TOOLKIT_OWNED_TEMP_REPORT_TOKEN: token }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /IPC channel is missing or unusable/);
    assert.equal(fs.existsSync(lease.path('must-not-write.md')), false);
    assert.equal(fs.existsSync(lease.path('repo/source-watch/reviews/active-third-party-updates.md')), false);
  });
});
function pausedReportStage(lease, apiBaseUrl, options = {}) {
  const originalOpen = fs.openSync;
  const originalLstat = fs.promises.lstat;
  const originalRename = fs.renameSync;
  const originalUnlink = fs.unlinkSync;
  const originalRmdir = fs.rmdirSync;
  const originalWriteFile = fs.writeFileSync;
  const originalPromiseRename = fs.promises.rename;
  const originalPromiseUnlink = fs.promises.unlink;
  const ChildProcess = require('node:child_process').ChildProcess;
  const originalEmit = ChildProcess.prototype.emit;
  const originalSend = ChildProcess.prototype.send;
  let negativeAckAttempts = 0;
  let negativeAckDelivered = 0;
  let coherentRebindMessages = 0;
  const originalApiBaseUrl = process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
  const destination = lease.path('workspace/repo/source-watch/reviews/active-third-party-updates.md');
  let stagePath = null;
  let boundaryReached = false;
  let completionSettled = false;
  let destinationMutations = 0;
  let eventSequence = 0;
  const observationEvents = [];
  const eventWaiters = new Set();
  let enterBoundary;
  let releaseBoundary;
  const entered = new Promise((resolve) => { enterBoundary = resolve; });
  let released = false;
  const gate = new Promise((resolve) => { releaseBoundary = () => { if (!released) { released = true; resolve(); } }; });
  const same = (left, right) => path.resolve(String(left)) === path.resolve(String(right));
  const isWriteMode = (flags) => typeof flags === 'number'
    ? (flags & 3) !== fs.constants.O_RDONLY
    : /[wax+]/.test(String(flags));
  const recordEvent = (type, value, details = {}) => {
    const event = { order: ++eventSequence, type, value, ...details };
    observationEvents.push(event);
    for (const waiter of [...eventWaiters]) waiter(event);
    if ((type === 'profile-failed' || type === 'child-disconnect' || type === 'child-close') && !released) {
      releaseBoundary();
    }
    return event;
  };
  const isProfileChild = (child) => Array.isArray(child.spawnargs)
    && child.spawnargs.some((argument) => String(argument).endsWith('check-project-source-updates.cjs'));
  ChildProcess.prototype.emit = function (event, ...args) {
    const profileChild = isProfileChild(this);
    const forwardedArgs = profileChild && event === 'close' && options.forceZeroExit ? [0, args[1]] : args;
    const result = originalEmit.call(this, event, ...forwardedArgs);

    if (profileChild && event === 'disconnect') recordEvent('child-disconnect', args, { pid: this.pid });
    if (profileChild && event === 'close') recordEvent('child-close', forwardedArgs, {
      pid: this.pid,
      actualExitCode: args[0],
      observedExitCode: forwardedArgs[0],
      signal: forwardedArgs[1],
      processGroup: process.platform !== 'win32'
    });
    return result;
  };
  ChildProcess.prototype.send = function (frame, callback) {
    let message = null;
    if (isProfileChild(this) && Buffer.isBuffer(frame)) {
      try { message = decodeReportIpcTestFrame(frame); } catch (_) {}
    }
    if (!message || message.acknowledged !== false) return originalSend.call(this, frame, callback);
    negativeAckAttempts += 1;
    recordEvent('negative-ack-attempt', message.acknowledged);
    return originalSend.call(this, frame, (caught) => {
      if (!caught) {
        negativeAckDelivered += 1;
        recordEvent('negative-ack-delivered', message.acknowledged);
        originalEmit.call(this, 'message', encodeReportFrame({
          version: 1, token: message.token, type: 'PUT_REPORT', content: 'coherent late report rebind'
        }));
        coherentRebindMessages += 1;
        if (options.abortOnNegativeAck) {
          recordEvent('external-abort-after-negative-ack', message.acknowledged);
          options.abortController.abort('external abort after profile failure');
        }
      }
      if (callback) callback(caught);
    });
  };

  fs.openSync = function (filePath, flags, ...args) {
    if (same(filePath, destination) && isWriteMode(flags)) destinationMutations += 1;
    const fd = originalOpen.call(this, filePath, flags, ...args);
    if (String(filePath).includes('active-third-party-updates.md.pending-')) stagePath = String(filePath);
    return fd;
  };
  fs.writeFileSync = function (filePath, ...args) {
    if (same(filePath, destination)) destinationMutations += 1;
    return originalWriteFile.call(this, filePath, ...args);
  };
  fs.renameSync = function (from, to, ...args) {
    if (same(to, destination)) destinationMutations += 1;
    return originalRename.call(this, from, to, ...args);
  };
  fs.unlinkSync = function (filePath, ...args) {
    if (same(filePath, destination)) destinationMutations += 1;
    return originalUnlink.call(this, filePath, ...args);
  };
  fs.promises.rename = async function (from, to, ...args) {
    if (same(to, destination)) destinationMutations += 1;
    return originalPromiseRename.call(this, from, to, ...args);
  };
  fs.promises.unlink = async function (filePath, ...args) {
    if (same(filePath, destination)) destinationMutations += 1;
    return originalPromiseUnlink.call(this, filePath, ...args);
  };
  fs.promises.lstat = async function (filePath, ...args) {
    if (!boundaryReached && stagePath && same(filePath, stagePath)) {
      boundaryReached = true;
      recordEvent('barrier', stagePath);
      enterBoundary();
      await gate;
    }
    return originalLstat.call(this, filePath, ...args);
  };

  process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = apiBaseUrl;
  const profilePromise = lease.runProfile('source-update');
  profilePromise.then(
    (value) => recordEvent('profile-resolved', value),
    (caught) => recordEvent('profile-failed', caught)
  );
  const completion = profilePromise.then(
    (value) => {
      completionSettled = true;
      if (originalApiBaseUrl === undefined) delete process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
      else process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = originalApiBaseUrl;
      return { status: 'resolved', value };
    },
    (error) => {
      completionSettled = true;
      if (originalApiBaseUrl === undefined) delete process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
      else process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = originalApiBaseUrl;
      return { status: 'rejected', error };
    }
  );
  const observeTerminalBeforeBarrier = async (event, label) => {
    releaseBoundary();
    const outcome = await completion;
    if (event.type === 'profile-failed') throw event.value;
    if (outcome.status === 'rejected') throw outcome.error;
    throw new Error('Observer failure: profile completed before ' + label + '.');
  };
  const waitForBarrier = (label) => {
    const terminalTypes = new Set(['profile-failed', 'profile-resolved', 'child-disconnect', 'child-close']);
    const classify = (event) => event.type === 'barrier'
      ? Promise.resolve(event)
      : observeTerminalBeforeBarrier(event, label);
    if (observationEvents.length) return classify(observationEvents[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        eventWaiters.delete(listener);
        releaseBoundary();
        reject(new Error('Timed out waiting for ' + label + '.'));
      }, 60000);
      const listener = (event) => {
        if (event.type !== 'barrier' && !terminalTypes.has(event.type)) return;
        eventWaiters.delete(listener);
        clearTimeout(timer);
        classify(event).then(resolve, reject);
      };
      eventWaiters.add(listener);
    });
  };
  return {
    entered,
    profilePromise,
    completion,
    destination,
    stagePath: () => stagePath,
    completionSettled: () => completionSettled,
    destinationMutations: () => destinationMutations,
    negativeAckAttempts: () => negativeAckAttempts,
    negativeAckDelivered: () => negativeAckDelivered,
    coherentRebindMessages: () => coherentRebindMessages,
    gateReleased: () => released,
    events: () => observationEvents.map((event) => ({ ...event })),
    waitForBarrier,
    release: releaseBoundary,
    originalRename,
    originalUnlink,
    originalRmdir,
    originalWriteFile,
    restore() {
      releaseBoundary();
      fs.openSync = originalOpen;
      fs.promises.lstat = originalLstat;
      fs.renameSync = originalRename;
      fs.unlinkSync = originalUnlink;
      fs.writeFileSync = originalWriteFile;
      fs.promises.rename = originalPromiseRename;
      fs.promises.unlink = originalPromiseUnlink;
      ChildProcess.prototype.emit = originalEmit;
      ChildProcess.prototype.send = originalSend;
      if (originalApiBaseUrl === undefined) delete process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
      else process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = originalApiBaseUrl;
    }
  };
}
function removeInjectedStagePath(stagePath, harness) {
  let stats;
  try { stats = fs.lstatSync(stagePath); }
  catch (caught) { if (caught.code === 'ENOENT') return; throw caught; }
  if (process.platform === 'win32' && stats.isDirectory()) harness.originalRmdir(stagePath);
  else harness.originalUnlink(stagePath);
}

async function assertRejectedStageMutation(episode, mutate, cleanup = () => {}, options = {}) {
  const baseline = ownedTempUsage();
  let workspaceError = null;
  let profileError = null;
  const cleanupState = { injected: false, restore: null, claimId: null, profileChild: null };
  try {
    await withOwnedWorkspace(ownedSpec(episode, options.abortController ? { signal: options.abortController.signal } : {}), async (lease) => {
    await writeJson(lease, 'workspace', sourceLockRel, activeLock());
    await lease.writeFile('workspace/repo/source-watch/reviews/active-third-party-updates.md', 'prior report');
    try { await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const harness = pausedReportStage(lease, apiBaseUrl, { forceZeroExit: true, ...options });
      let backupPath = null;
      try {
        await waitForTestBarrier(harness, 'staged report async boundary');
        const stagePath = harness.stagePath();
        assert.ok(stagePath);
        const originalPayload = fs.readFileSync(stagePath);
        const originalStats = fs.lstatSync(stagePath, { bigint: true });
        backupPath = stagePath + '.original';
        harness.originalRename(stagePath, backupPath);
        await mutate({ stagePath, originalPayload, backupPath, harness });
        harness.release();
        const outcome = await harness.completion;
        assert.equal(outcome.status, 'rejected', outcome.value && outcome.value.stderr);
        assert.equal(outcome.error.code, 'TEMP_OWNERSHIP_UNCERTAIN');
        profileError = outcome.error;
        if (options.failCleanupOnDestination) {
          const close = harness.events().find((event) => event.type === 'child-close');
          assert.ok(close, 'The owner must observe terminal close for the profile child before cleanup begins.');
          assert.ok(Number.isSafeInteger(close.pid) && close.pid > 0);
          assert.equal(close.observedExitCode, 0, 'The profile child close callback must report the deliberately forced zero exit.');
          assert.equal(close.signal, null);
          lifecycleProcessGroupIsAbsent(close.pid, 'Owned source-update profile child');
          cleanupState.profileChild = {
            pid: close.pid,
            actualExitCode: close.actualExitCode,
            observedExitCode: close.observedExitCode,
            signal: close.signal,
            processGroup: close.processGroup,
            processAbsent: true,
            processGroupAbsent: process.platform !== 'win32'
          };
        }
        assert.equal(harness.negativeAckAttempts(), 1, 'parent identity failure should send one NACK');
        assert.equal(harness.negativeAckDelivered(), 1, 'NACK transport callback success is delivery only');
        assert.equal(harness.coherentRebindMessages(), 1, 'a later coherent report frame was attempted');
        assert.equal(harness.destinationMutations(), 0, 'neither the rejected nor rebound report may mutate the destination');
        assert.equal(fs.readFileSync(harness.destination, 'utf8'), 'prior report');
        if (options.abortOnNegativeAck) {
          const events = harness.events();
          const eventIndex = (type) => events.findIndex((event) => event.type === type);
          assert.ok(eventIndex('negative-ack-attempt') >= 0);
          assert.ok(eventIndex('negative-ack-attempt') < eventIndex('negative-ack-delivered'));
          assert.ok(eventIndex('negative-ack-delivered') < eventIndex('external-abort-after-negative-ack'));
          assert.ok(eventIndex('external-abort-after-negative-ack') < eventIndex('profile-failed'));
          const close = events.find((event) => event.type === 'child-close');
          assert.ok(close, 'the child close event must follow the injected terminal failure');
          assert.equal(close.value[0], 0, 'the child exit callback must report zero after the first profile failure');
        }
        if (fs.existsSync(stagePath)) {
          const replacementStats = fs.lstatSync(stagePath, { bigint: true });
          assert.notDeepEqual(
            { dev: String(replacementStats.dev), ino: String(replacementStats.ino) },
            { dev: String(originalStats.dev), ino: String(originalStats.ino) }
          );
        }
      } finally {
        harness.release();
        const stagePath = harness.stagePath();
        if (stagePath) removeInjectedStagePath(stagePath, harness);
        if (backupPath && fs.existsSync(backupPath)) harness.originalRename(backupPath, stagePath);
        await cleanup({ stagePath, harness });
        harness.restore();
      }
    }); } finally {
    if (options.failCleanupOnDestination && profileError) {
      const record = inspectOwnedTemps().records.find((item) => item.rootPath === lease.root);
      assert.ok(record, 'the public owned-temp claim must remain active before cleanup');
      cleanupState.claimId = record.claimId;
      const originalRmdir = fs.rmdirSync;
      const injectedRmdir = function (directoryPath, ...args) {
        if (!cleanupState.injected && path.resolve(String(directoryPath)) === path.resolve(lease.root)) {
          cleanupState.injected = true;
          throw Object.assign(new Error('injected cleanup failure after source-update profile failure'), { code: 'EIO' });
        }
        return originalRmdir.call(this, directoryPath, ...args);
      };
      fs.rmdirSync = injectedRmdir;
      cleanupState.restore = () => {
        if (fs.rmdirSync === injectedRmdir) fs.rmdirSync = originalRmdir;
      };
    }
    }
  });
  } catch (caught) {
    workspaceError = caught;
  } finally {
    if (cleanupState.restore) cleanupState.restore();
  }
  assert.ok(workspaceError, 'Identity rejection must fail the owned-temp operation.');
  assert.equal(workspaceError.code, 'TEMP_OWNERSHIP_UNCERTAIN', workspaceError.stack);
  assert.strictEqual(workspaceError, profileError, 'the first parent-side causal error must remain primary');
  if (options.failCleanupOnDestination) {
    assert.equal(cleanupState.injected, true);
    assert.equal(workspaceError.cleanupCode, 'TEMP_CLEANUP_INCOMPLETE');
    assert.equal(workspaceError.cleanupStatus.status, 'CLEANUP_INCOMPLETE');
    assert.equal(workspaceError.cleanupStatus.code, 'EIO');
    const cleanupRecord = inspectOwnedTemps().records.find((record) => record.claimId === cleanupState.claimId);
    assert.ok(cleanupRecord && cleanupRecord.rootPath);
    assert.equal(options.deferResidue, true, 'Incomplete cleanup must be handed to an independent observer.');
    assert.ok(cleanupState.profileChild, 'Descendant close and process-group extinction must be proven first.');
    return {
      strictPrimaryErrorIdentity: true,
      primaryErrorCode: workspaceError.code,
      cleanupStatus: workspaceError.cleanupStatus,
      claimId: cleanupState.claimId,
      rootPath: cleanupRecord.rootPath,
      profileChild: cleanupState.profileChild,
      residue: readLifecycleResidue(os.tmpdir(), cleanupState.claimId)
    };
  }
  assert.deepEqual(ownedTempUsage(), baseline);
}

function createLifecycleTempRoot(label) {
  const tempParent = path.resolve(os.tmpdir());
  const parentStats = fs.lstatSync(tempParent);
  assert.ok(parentStats.isDirectory() && !parentStats.isSymbolicLink(), 'The system temporary parent must be a real directory.');
  const createdRoot = fs.mkdtempSync(path.join(tempParent, 'w2a-g3-' + label + '-'));
  const tempRoot = fs.realpathSync.native(createdRoot);
  if (process.platform !== 'win32') fs.chmodSync(tempRoot, 0o700);
  const resolvedRoot = fs.realpathSync.native(tempRoot);
  assert.equal(path.resolve(resolvedRoot), path.resolve(tempRoot), 'Lifecycle root must not traverse a symlink.');
  const sentinelPath = path.join(tempRoot, lifecycleSentinel);
  const sentinelBytes = Buffer.from('preserve-this-unrelated-lifecycle-sentinel:' + label + '\n');
  const fd = fs.openSync(sentinelPath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, sentinelBytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const rootStats = fs.lstatSync(tempRoot, { bigint: true });
  const sentinel = lifecycleFileSnapshot(sentinelPath);
  const namespacePath = path.join(tempRoot, lifecycleNamespace);
  assert.equal(fs.existsSync(namespacePath), false, 'Each lifecycle case must start in a fresh owned namespace.');
  return {
    label,
    path: tempRoot,
    realPath: resolvedRoot,
    identity: lifecycleStatIdentity(rootStats),
    sentinelBytesBase64: sentinelBytes.toString('base64'),
    sentinel
  };
}

function assertLifecycleCustodyUnchangedExceptClaim(actual, expected, claimId) {
  const comparable = (custody) => {
    const copy = JSON.parse(JSON.stringify(custody));
    delete copy.claim;
    const claimName = claimId + '.claim.json';
    const claimEntry = copy.claims.entries.find((entry) => entry.name === claimName);
    assert.ok(claimEntry, 'The claim file remains present while its PID contradiction is under review.');
    copy.claims.entries = copy.claims.entries.map((entry) => entry.name === claimName
      ? { name: entry.name, type: entry.type, identity: entry.identity }
      : entry);
    return copy;
  };
  assert.deepEqual(comparable(actual), comparable(expected));
  assert.deepEqual(actual.claim.identity, expected.claim.identity, 'Claim mutation must preserve the original file identity.');
  assert.equal(actual.claim.path, expected.claim.path);
}

function rewriteLifecycleClaimInPlace(claimPath, bytes) {
  const before = lifecycleFileSnapshot(claimPath);
  const fd = fs.openSync(claimPath, 'r+');
  try {
    fs.writeSync(fd, bytes, 0, bytes.length, 0);
    fs.ftruncateSync(fd, bytes.length);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const after = lifecycleFileSnapshot(claimPath);
  assert.deepEqual(after.identity, before.identity, 'In-place claim rewrite must preserve the original file identity.');
  assert.equal(after.size, bytes.length);
  assert.equal(after.sha256, lifecycleSha256(bytes));
  return after;
}

function exitedLifecycleHelperPid() {
  const result = spawnSync(process.execPath, ['-p', 'process.pid'], {
    encoding: 'utf8',
    windowsHide: true
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  const pid = Number(result.stdout.trim());
  lifecycleProcessIsAbsent(pid, 'Separately confirmed exited claim-PID contradiction helper');
  return pid;
}

function launchLifecycleRole(role, tempCase, options = {}) {
  const receiptPath = path.join(tempCase.path, 'receipt-' + role + '.w2a');
  assert.equal(fs.existsSync(receiptPath), false, 'Each lifecycle role receipt path must be fresh.');
  const env = {
    ...process.env,
    TEMP: tempCase.path,
    TMP: tempCase.path,
    TMPDIR: tempCase.path,
    [lifecycleRoleEnv]: role,
    [lifecycleRootEnv]: tempCase.path,
    [lifecycleReceiptEnv]: receiptPath
  };
  delete env.NODE_TEST_CONTEXT;
  if (options.claimId) env[lifecycleClaimEnv] = options.claimId;
  if (options.ownerPid !== undefined) env[lifecycleOwnerEnv] = String(options.ownerPid);
  const pattern = '^' + lifecycleTestName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=' + pattern, __filename], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, role + ' lifecycle role must exit normally.');
  assert.equal(result.status, 0, role + ' lifecycle role failed.\n' + result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /^TAP version 13$/m);
  assert.match(result.stdout, /^# pass 1$/m);
  assert.match(result.stdout, /^# fail 0$/m);
  assert.ok(result.stdout.includes(lifecycleTestName), 'The role receipt must come from the selected lifecycle test.');
  assert.equal(fs.existsSync(receiptPath), true, role + ' lifecycle role must leave one complete framed receipt.');
  const receipt = readLifecycleReceipt(receiptPath);
  assert.equal(receipt.role, role);
  return {
    role,
    receiptPath,
    receipt,
    receiptSnapshot: lifecycleFileSnapshot(receiptPath),
    stdoutSha256: lifecycleSha256(Buffer.from(result.stdout)),
    stderrSha256: lifecycleSha256(Buffer.from(result.stderr))
  };
}

async function runLifecycleOwnerRole(role) {
  const tempRoot = path.resolve(os.tmpdir());
  assert.equal(path.resolve(process.env.TEMP), tempRoot);
  assert.equal(path.resolve(process.env.TMP), tempRoot);
  assert.equal(path.resolve(process.env.TMPDIR), tempRoot);
  assert.equal(tempRoot, path.resolve(process.env[lifecycleRootEnv]));
  assert.equal(fs.existsSync(path.join(tempRoot, lifecycleNamespace)), false);
  const baseline = ownedTempUsage();
  assert.equal(baseline.records, 0, 'Owner namespace must begin without claims.');
  assert.equal(baseline.outstandingReservationsBytes, 0);
  assert.equal(baseline.retainedRoots, 0);
  const result = await assertRejectedStageMutation(
    'owned-report-profile-failure-cleanup-incomplete-' + role,
    ({ stagePath, harness }) => harness.originalWriteFile(stagePath, 'foreign replacement', 'utf8'),
    () => {},
    { failCleanupOnDestination: true, deferResidue: true }
  );
  assert.ok(result);
  assert.equal(result.strictPrimaryErrorIdentity, true);
  assert.equal(result.primaryErrorCode, 'TEMP_OWNERSHIP_UNCERTAIN');
  assert.equal(result.cleanupStatus.status, 'CLEANUP_INCOMPLETE');
  assert.equal(result.cleanupStatus.code, 'EIO');
  assert.equal(result.residue.ownerPid, process.pid);
  assert.equal(result.profileChild.processAbsent, true);
  assert.equal(result.profileChild.processGroupAbsent, process.platform !== 'win32');
  const accounting = ownedTempUsage();
  assert.equal(accounting.records, 1);
  assert.equal(accounting.outstandingReservationsBytes, lifecycleBudgetBytes + lifecycleMetadataBytes);
  assert.equal(accounting.retainedRoots, 0);
  return {
    schema: 'ai-agent-toolkit.w2a-g3-lifecycle-role.v1',
    role,
    processPid: process.pid,
    strictPrimaryErrorIdentity: true,
    primaryErrorCode: result.primaryErrorCode,
    cleanupStatus: result.cleanupStatus,
    profileChild: result.profileChild,
    residue: result.residue,
    postOwnerAccounting: accounting
  };
}

async function runLifecycleNegativeObserverRole() {
  const tempRoot = path.resolve(os.tmpdir());
  const claimId = process.env[lifecycleClaimEnv];
  const ownerPid = Number(process.env[lifecycleOwnerEnv]);
  assert.ok(/^[a-f0-9]{32}$/.test(claimId));
  lifecycleProcessIsAbsent(ownerPid, 'Original lifecycle owner');
  const paths = lifecyclePaths(tempRoot, claimId);
  const claim = JSON.parse(fs.readFileSync(paths.claimPath, 'utf8'));
  const marker = JSON.parse(fs.readFileSync(paths.markerPath, 'utf8'));
  assert.notEqual(claim.process.pid, ownerPid, 'Negative fixture changes only the claim PID after owner exit.');
  lifecycleProcessIsAbsent(claim.process.pid, 'Contradictory claim PID');
  assert.equal(marker.process.pid, ownerPid, 'Outer marker retains the original owner tuple.');
  assert.equal(marker.root_marker.process.pid, ownerPid, 'Embedded marker retains the original owner tuple.');
  const before = captureLifecycleCustody(tempRoot, claimId);
  const monitor = lifecycleNoEffectMonitor(tempRoot, claimId);
  let inspection;
  let recovery;
  let admissionError = null;
  let callbackCount = 0;
  try {
    inspection = inspectOwnedTemps();
    assert.equal(inspection.records.length, 1);
    assert.deepEqual(inspection.records[0], {
      state: 'HOLD',
      claimPath: paths.claimPath,
      code: 'TEMP_OWNERSHIP_UNCERTAIN'
    });
    assert.equal(inspection.outstandingReservationsBytes, 0);
    assert.equal(inspection.retainedRoots, 0);

    recovery = await recoverStaleOwnedTemps();
    assert.deepEqual(recovery, [{ status: 'HOLD', claimPath: paths.claimPath, code: 'TEMP_OWNERSHIP_UNCERTAIN' }]);

    await assert.rejects(withOwnedWorkspace(
      ownedSpec('owned-report-contradictory-claim-owner-admission-hold'),
      async () => { callbackCount += 1; }
    ), (caught) => {
      admissionError = caught;
      return caught && caught.code === 'TEMP_CAPACITY_UNKNOWN';
    });
  } finally {
    monitor.restore();
  }
  assert.equal(admissionError.code, 'TEMP_CAPACITY_UNKNOWN');
  assert.equal(admissionError.cause && admissionError.cause.code, 'TEMP_OWNERSHIP_UNCERTAIN');
  assert.equal(callbackCount, 0, 'No admission callback may run while owner evidence conflicts.');
  assert.deepEqual(monitor.effects, [], 'Inspection, recovery, and admission must have zero effects on the residue.');
  const after = captureLifecycleCustody(tempRoot, claimId);
  assert.deepEqual(after, before, 'All durable bytes, identities, and namespace entries remain exact across HOLD.');
  return {
    schema: 'ai-agent-toolkit.w2a-g3-lifecycle-role.v1',
    role: 'negative-observer',
    ownerPid,
    contradictoryClaimPid: claim.process.pid,
    inspection,
    recovery,
    admission: { errorCode: admissionError.code, causeCode: admissionError.cause && admissionError.cause.code, callbackCount },
    protectedEffects: monitor.effects,
    custodyBefore: before,
    custodyAfter: after
  };
}

async function runLifecycleRecoveryObserverRole(role) {
  const tempRoot = path.resolve(os.tmpdir());
  const claimId = process.env[lifecycleClaimEnv];
  const ownerPid = Number(process.env[lifecycleOwnerEnv]);
  assert.ok(/^[a-f0-9]{32}$/.test(claimId));
  lifecycleProcessIsAbsent(ownerPid, role + ' original owner');
  const paths = lifecyclePaths(tempRoot, claimId);
  const before = captureLifecycleCustody(tempRoot, claimId);
  const claim = JSON.parse(fs.readFileSync(paths.claimPath, 'utf8'));
  const lease = JSON.parse(fs.readFileSync(paths.leasePath, 'utf8'));
  const marker = JSON.parse(fs.readFileSync(paths.markerPath, 'utf8'));
  assert.equal(claim.process.pid, ownerPid, 'Recovery witness must keep the original claim PID untouched.');
  assert.deepEqual(marker.process, claim.process);
  assert.deepEqual(marker.root_marker.process, claim.process);
  assert.equal(lease.status, 'CLEANUP_INCOMPLETE');
  assert.equal(lease.last_error_code, 'EIO');
  assert.equal(lease.root_removed, false);
  assert.equal(lease.root_marker_removed, true);
  assert.equal(lease.retention, null);
  assert.deepEqual(lease.owned_children, []);
  assert.deepEqual(fs.readdirSync(paths.rootPath), [], 'The residue root is independently verified empty.');
  assert.equal(fs.existsSync(paths.rootMarkerPath), false);

  const inspection = inspectOwnedTemps();
  const row = inspection.records.find((record) => record.claimId === claimId);
  assert.ok(row);
  assert.equal(row.state, 'CLEANUP_INCOMPLETE');
  assert.equal(row.reservationBytes, lifecycleBudgetBytes + lifecycleMetadataBytes);
  assert.equal(row.bytesReserved, lease.bytes_reserved);
  assert.equal(row.retained, false);
  assert.equal(inspection.outstandingReservationsBytes, lifecycleBudgetBytes + lifecycleMetadataBytes);
  assert.equal(inspection.retainedRoots, 0);

  const recovery = await recoverStaleOwnedTemps();
  assert.equal(recovery.length, 1);
  assert.deepEqual(recovery[0], {
    status: 'REMOVED',
    claimId,
    rootRemoved: true,
    evidence: 'dead'
  });
  assert.equal(fs.existsSync(paths.claimPath), false);
  assert.equal(fs.existsSync(paths.leasePath), false);
  assert.equal(fs.existsSync(paths.markerPath), false);
  assert.equal(fs.existsSync(paths.rootPath), false);
  const afterRecovery = captureLifecycleCustody(tempRoot, claimId);
  assert.deepEqual(afterRecovery.claims.entries, []);
  assert.deepEqual(afterRecovery.roots.entries, []);
  assert.equal(afterRecovery.admissionLock.exists, false);
  const emptyInspection = inspectOwnedTemps();
  assert.deepEqual(emptyInspection.records, []);
  assert.equal(emptyInspection.outstandingReservationsBytes, 0);
  assert.equal(emptyInspection.retainedRoots, 0);

  let callbackCount = 0;
  const admissionValue = await withOwnedWorkspace(
    ownedSpec('owned-report-confirmed-dead-admission-' + role),
    async () => { callbackCount += 1; return 'admitted-after-confirmed-dead-recovery'; }
  );
  assert.equal(admissionValue, 'admitted-after-confirmed-dead-recovery');
  assert.equal(callbackCount, 1, 'A clean post-recovery admission callback runs exactly once.');
  const afterAdmission = captureLifecycleCustody(tempRoot, claimId);
  assert.deepEqual(afterAdmission, afterRecovery, 'The valid admission leaves no additional claim or root behind.');
  const finalInspection = inspectOwnedTemps();
  assert.deepEqual(finalInspection.records, []);
  assert.equal(finalInspection.outstandingReservationsBytes, 0);
  assert.equal(finalInspection.retainedRoots, 0);
  assert.deepEqual(await recoverStaleOwnedTemps(), []);
  return {
    schema: 'ai-agent-toolkit.w2a-g3-lifecycle-role.v1',
    role,
    ownerPid,
    inspection,
    recovery,
    custodyBefore: before,
    custodyAfterRecovery: afterRecovery,
    admission: { value: admissionValue, callbackCount },
    custodyAfterAdmission: afterAdmission,
    finalInspection
  };
}

function removeLifecycleTempRoot(tempCase, receipts) {
  const tempRoot = tempCase.path;
  const namespacePath = path.join(tempRoot, lifecycleNamespace);
  const claimsPath = path.join(namespacePath, 'claims');
  const rootsPath = path.join(namespacePath, 'roots');
  const sentinelPath = path.join(tempRoot, lifecycleSentinel);
  const rootStats = fs.lstatSync(tempRoot, { bigint: true });
  assert.deepEqual(lifecycleStatIdentity(rootStats), tempCase.identity);
  assert.deepEqual(fs.readdirSync(claimsPath), [], 'Public recovery must leave the owned claims directory empty.');
  assert.deepEqual(fs.readdirSync(rootsPath), [], 'Public recovery must leave the owned roots directory empty.');
  assert.equal(fs.existsSync(path.join(namespacePath, 'admission.lock.json')), false);
  const namespaceMarker = JSON.parse(fs.readFileSync(path.join(namespacePath, 'namespace.json'), 'utf8'));
  assert.ok(namespaceMarker && typeof namespaceMarker === 'object');
  const expectedEntries = [lifecycleNamespace, lifecycleSentinel, ...receipts.map((item) => path.basename(item.receiptPath))].sort();
  assert.deepEqual(fs.readdirSync(tempRoot).sort(), expectedEntries, 'Only exact test-owned evidence and the sentinel may remain before teardown.');

  fs.unlinkSync(path.join(namespacePath, 'namespace.json'));
  fs.rmdirSync(claimsPath);
  fs.rmdirSync(rootsPath);
  fs.rmdirSync(namespacePath);
  assert.deepEqual(lifecycleFileSnapshot(sentinelPath), tempCase.sentinel, 'Unrelated sentinel bytes and identity remain unchanged.');
  for (const item of receipts) {
    assert.deepEqual(lifecycleFileSnapshot(item.receiptPath), item.receiptSnapshot, 'Completed framed role receipt remains intact until its durable copy exists.');
    fs.unlinkSync(item.receiptPath);
  }
  fs.unlinkSync(sentinelPath);
  assert.deepEqual(fs.readdirSync(tempRoot), []);
  assert.deepEqual(lifecycleStatIdentity(fs.lstatSync(tempRoot, { bigint: true })), tempCase.identity);
  fs.rmdirSync(tempRoot);
}

async function runLifecycleSupervisor() {
  const negativeCase = createLifecycleTempRoot('negative');
  const positiveCase = createLifecycleTempRoot('positive');
  const allReceipts = [];
  const evidence = {
    schema: 'ai-agent-toolkit.w2a-g3-semantic-snapshot-lifecycle-evidence.v1',
    run: 'w2a-f154-f1-semantic-snapshot-g3-20261002-001',
    lock: 'DL-W2A-F154-F1-SNAPSHOT-G3-001',
    cases: {}
  };

  assert.notEqual(negativeCase.path, positiveCase.path);
  assert.notEqual(path.join(negativeCase.path, lifecycleNamespace), path.join(positiveCase.path, lifecycleNamespace));

  const negativeOwner = launchLifecycleRole('negative-owner', negativeCase);
  allReceipts.push(negativeOwner);
  const negativeResidue = negativeOwner.receipt.residue;
  assert.equal(negativeOwner.receipt.processPid, negativeResidue.ownerPid);
  assert.equal(negativeResidue.claim.process.pid, negativeResidue.ownerPid);
  assert.equal(negativeOwner.receipt.strictPrimaryErrorIdentity, true);
  lifecycleProcessGroupIsAbsent(negativeOwner.receipt.profileChild.pid, 'Negative-case profile child');
  lifecycleProcessIsAbsent(negativeResidue.ownerPid, 'Negative-case actual claim owner');
  const negativePaths = lifecyclePaths(negativeCase.path, negativeResidue.claimId);
  const negativeOriginalBytes = Buffer.from(negativeResidue.claimBytesBase64, 'base64');
  assert.equal(lifecycleSha256(negativeOriginalBytes), negativeResidue.custody.claim.sha256);
  assert.deepEqual(fs.readFileSync(negativePaths.claimPath), negativeOriginalBytes, 'Owner receipt must carry the exact original claim bytes.');
  const negativeBeforeMutation = captureLifecycleCustody(negativeCase.path, negativeResidue.claimId);
  assert.deepEqual(negativeBeforeMutation, negativeResidue.custody, 'Residue is unchanged after the owner process exits.');

  const contradictoryPid = exitedLifecycleHelperPid();
  assert.notEqual(contradictoryPid, negativeResidue.ownerPid);
  assert.notEqual(contradictoryPid, negativeOwner.receipt.profileChild.pid);
  const contradictoryClaim = JSON.parse(negativeOriginalBytes.toString('utf8'));
  contradictoryClaim.process.pid = contradictoryPid;
  const expectedContradictoryClaim = JSON.parse(negativeOriginalBytes.toString('utf8'));
  expectedContradictoryClaim.process.pid = contradictoryPid;
  const contradictoryBytes = Buffer.from(JSON.stringify(contradictoryClaim));
  rewriteLifecycleClaimInPlace(negativePaths.claimPath, contradictoryBytes);
  const negativeMutatedCustody = captureLifecycleCustody(negativeCase.path, negativeResidue.claimId);
  assertLifecycleCustodyUnchangedExceptClaim(negativeMutatedCustody, negativeBeforeMutation, negativeResidue.claimId);
  const actualContradictoryClaim = JSON.parse(fs.readFileSync(negativePaths.claimPath, 'utf8'));
  assert.deepEqual(actualContradictoryClaim, expectedContradictoryClaim, 'The sole structural contradiction is claim.process.pid.');
  const claimWithOriginalPid = JSON.parse(JSON.stringify(actualContradictoryClaim));
  claimWithOriginalPid.process.pid = negativeResidue.ownerPid;
  assert.deepEqual(claimWithOriginalPid, negativeResidue.claim);

  const negativeObserver = launchLifecycleRole('negative-observer', negativeCase, {
    claimId: negativeResidue.claimId,
    ownerPid: negativeResidue.ownerPid
  });
  allReceipts.push(negativeObserver);
  assert.deepEqual(negativeObserver.receipt.custodyBefore, negativeMutatedCustody);
  assert.deepEqual(negativeObserver.receipt.custodyAfter, negativeMutatedCustody);
  assert.deepEqual(negativeObserver.receipt.protectedEffects, []);
  assert.equal(negativeObserver.receipt.inspection.records[0].code, 'TEMP_OWNERSHIP_UNCERTAIN');
  assert.equal(negativeObserver.receipt.recovery[0].code, 'TEMP_OWNERSHIP_UNCERTAIN');
  assert.deepEqual(negativeObserver.receipt.admission, {
    errorCode: 'TEMP_CAPACITY_UNKNOWN',
    causeCode: 'TEMP_OWNERSHIP_UNCERTAIN',
    callbackCount: 0
  });
  const negativeAfterObserver = captureLifecycleCustody(negativeCase.path, negativeResidue.claimId);
  assert.deepEqual(negativeAfterObserver, negativeMutatedCustody);

  const claimIdentityBeforeRestore = negativeAfterObserver.claim.identity;
  rewriteLifecycleClaimInPlace(negativePaths.claimPath, negativeOriginalBytes);
  const negativeRestoredCustody = captureLifecycleCustody(negativeCase.path, negativeResidue.claimId);
  assertLifecycleCustodyUnchangedExceptClaim(negativeRestoredCustody, negativeBeforeMutation, negativeResidue.claimId);
  assert.deepEqual(negativeRestoredCustody.claim.identity, claimIdentityBeforeRestore);
  assert.equal(negativeRestoredCustody.claim.sha256, negativeBeforeMutation.claim.sha256);
  assert.deepEqual(fs.readFileSync(negativePaths.claimPath), negativeOriginalBytes, 'Original claim bytes are restored only after all negative HOLD assertions.');
  assert.deepEqual(JSON.parse(fs.readFileSync(negativePaths.claimPath, 'utf8')), negativeResidue.claim);

  const negativeRecovery = launchLifecycleRole('negative-restored-recovery-observer', negativeCase, {
    claimId: negativeResidue.claimId,
    ownerPid: negativeResidue.ownerPid
  });
  allReceipts.push(negativeRecovery);
  assert.deepEqual(negativeRecovery.receipt.custodyBefore, negativeRestoredCustody);
  assert.equal(negativeRecovery.receipt.recovery[0].status, 'REMOVED');
  assert.equal(negativeRecovery.receipt.recovery[0].evidence, 'dead');
  assert.equal(negativeRecovery.receipt.admission.callbackCount, 1);

  const positiveOwner = launchLifecycleRole('positive-owner', positiveCase);
  allReceipts.push(positiveOwner);
  const positiveResidue = positiveOwner.receipt.residue;
  assert.notEqual(positiveCase.path, negativeCase.path);
  assert.equal(positiveOwner.receipt.processPid, positiveResidue.ownerPid);
  assert.equal(positiveResidue.claim.process.pid, positiveResidue.ownerPid);
  assert.equal(positiveOwner.receipt.strictPrimaryErrorIdentity, true);
  lifecycleProcessGroupIsAbsent(positiveOwner.receipt.profileChild.pid, 'Positive-case profile child');
  lifecycleProcessIsAbsent(positiveResidue.ownerPid, 'Positive-case actual claim owner');
  const positivePaths = lifecyclePaths(positiveCase.path, positiveResidue.claimId);
  const positiveOriginalBytes = Buffer.from(positiveResidue.claimBytesBase64, 'base64');
  assert.deepEqual(fs.readFileSync(positivePaths.claimPath), positiveOriginalBytes);
  const positiveBeforeRecovery = captureLifecycleCustody(positiveCase.path, positiveResidue.claimId);
  assert.deepEqual(positiveBeforeRecovery, positiveResidue.custody, 'The independent positive residue stays untouched after owner exit.');

  const positiveRecovery = launchLifecycleRole('positive-untouched-recovery-observer', positiveCase, {
    claimId: positiveResidue.claimId,
    ownerPid: positiveResidue.ownerPid
  });
  allReceipts.push(positiveRecovery);
  assert.deepEqual(positiveRecovery.receipt.custodyBefore, positiveBeforeRecovery);
  assert.equal(positiveRecovery.receipt.recovery[0].status, 'REMOVED');
  assert.equal(positiveRecovery.receipt.recovery[0].evidence, 'dead');
  assert.equal(positiveRecovery.receipt.admission.callbackCount, 1);

  evidence.cases.negative = {
    tempRoot: negativeCase.path,
    rootIdentity: negativeCase.identity,
    sentinel: negativeCase.sentinel,
    owner: negativeOwner,
    contradictoryPid,
    custodyBeforeMutation: negativeBeforeMutation,
    custodyAfterMutation: negativeMutatedCustody,
    negativeObserver,
    custodyAfterNegativeObserver: negativeAfterObserver,
    custodyAfterRestore: negativeRestoredCustody,
    recoveryObserver: negativeRecovery
  };
  evidence.cases.positive = {
    tempRoot: positiveCase.path,
    rootIdentity: positiveCase.identity,
    sentinel: positiveCase.sentinel,
    owner: positiveOwner,
    custodyBeforeRecovery: positiveBeforeRecovery,
    recoveryObserver: positiveRecovery
  };
  evidence.roleReceipts = allReceipts.map((item) => ({
    role: item.role,
    path: item.receiptPath,
    receiptSha256: item.receiptSnapshot.sha256,
    stdoutSha256: item.stdoutSha256,
    stderrSha256: item.stderrSha256
  }));

  let durableEvidence = null;
  if (process.env[lifecycleEvidenceDirEnv]) {
    const evidenceDir = path.resolve(process.env[lifecycleEvidenceDirEnv]);
    const evidenceStats = fs.lstatSync(evidenceDir);
    assert.ok(evidenceStats.isDirectory() && !evidenceStats.isSymbolicLink(), 'The authorized checkpoint directory must be a real directory.');
    const evidencePath = path.join(evidenceDir, 'w2a-g3-f1-lifecycle-' + process.pid + '.w2a');
    writeLifecycleReceipt(evidencePath, evidence);
    durableEvidence = { path: evidencePath, snapshot: lifecycleFileSnapshot(evidencePath) };
  }
  evidence.durableEvidence = durableEvidence;

  removeLifecycleTempRoot(negativeCase, allReceipts.filter((item) => item.receiptPath.startsWith(negativeCase.path + path.sep)));
  removeLifecycleTempRoot(positiveCase, allReceipts.filter((item) => item.receiptPath.startsWith(positiveCase.path + path.sep)));
  if (durableEvidence) {
    assert.deepEqual(lifecycleFileSnapshot(durableEvidence.path), durableEvidence.snapshot);
  }
}

test('source-update owner failure survives external abort after NACK delivery and zero child exit', async () => {
  const controller = new AbortController();
  await assertRejectedStageMutation(
    'owned-report-failure-before-external-abort',
    ({ stagePath, harness }) => harness.originalWriteFile(stagePath, 'foreign replacement', 'utf8'),
    () => {},
    { abortController: controller, abortOnNegativeAck: true }
  );
});


test('source-update external abort before a profile failure remains TEMP_ABORTED at the public boundary', async () => {
  const baseline = ownedTempUsage();
  const controller = new AbortController();
  let profileOutcome = null;
  await assert.rejects(withOwnedWorkspace(ownedSpec('owned-report-external-abort-first', { signal: controller.signal }), async (lease) => {
    await writeJson(lease, 'workspace', sourceLockRel, activeLock());
    await lease.writeFile('workspace/repo/source-watch/reviews/active-third-party-updates.md', 'prior report');
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const harness = pausedReportStage(lease, apiBaseUrl);
      try {
        await waitForTestBarrier(harness, 'staged report async boundary');
        assert.equal(harness.completionSettled(), false, 'the profile has no terminal failure before the external abort');
        controller.abort('external abort before source-update profile failure');
        harness.release();
        profileOutcome = await harness.completion;
        assert.equal(profileOutcome.status, 'rejected');
        assert.notEqual(profileOutcome.error.code, 'TEMP_OWNERSHIP_UNCERTAIN');
        assert.equal(harness.destinationMutations(), 0);
        assert.equal(fs.readFileSync(harness.destination, 'utf8'), 'prior report');
      } finally {
        harness.release();
        await harness.completion;
        const stagePath = harness.stagePath();
        if (stagePath) removeInjectedStagePath(stagePath, harness);
        harness.restore();
      }
    });
  }), (caught) => caught && caught.code === 'TEMP_ABORTED');
  assert.equal(profileOutcome.status, 'rejected');
  assert.notEqual(profileOutcome.error.code, 'TEMP_OWNERSHIP_UNCERTAIN');
  assert.deepEqual(ownedTempUsage(), baseline);
});

test(lifecycleTestName, async () => {
  const role = process.env[lifecycleRoleEnv];
  if (role) {
    const receiptPath = process.env[lifecycleReceiptEnv];
    assert.ok(receiptPath, 'Each isolated lifecycle role requires its exact receipt path.');
    let receipt;
    if (role === 'negative-owner' || role === 'positive-owner') {
      receipt = await runLifecycleOwnerRole(role);
    } else if (role === 'negative-observer') {
      receipt = await runLifecycleNegativeObserverRole();
      receipt.role = role;
    } else if (role === 'negative-restored-recovery-observer' || role === 'positive-untouched-recovery-observer') {
      receipt = await runLifecycleRecoveryObserverRole(role);
    } else {
      assert.fail('Unknown lifecycle role: ' + role);
    }
    writeLifecycleReceipt(receiptPath, receipt);
    return;
  }
  await runLifecycleSupervisor();
});

test('staged identity observer surfaces a profile failure before the lstat barrier promptly', async () => {
  const baseline = ownedTempUsage();
  let observed = null;
  await assert.rejects(withOwnedWorkspace(ownedSpec('owned-report-observer-early-failure'), async (lease) => {
    await writeJson(lease, 'workspace', sourceLockRel, activeLock());
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const harness = pausedReportStage(lease, apiBaseUrl);
      try {
        const startedAt = Date.now();

        await assert.rejects(waitForTestBarrier(harness, 'staged report async boundary'), (caught) => {
          observed = caught;
          return caught.code === 'TEMP_CHILD_FAILED';
        });
        assert.ok(Date.now() - startedAt < 5000, 'observer should not wait for the 60-second barrier timeout');
        const outcome = await harness.completion;
        assert.equal(outcome.status, 'rejected');
        assert.strictEqual(outcome.error, observed);
        assert.equal(harness.events().some((event) => event.type === 'barrier'), false);
      } finally {
        harness.release();
        await harness.completion;
        harness.restore();
      }
    }, 500);
  }), (caught) => {
    assert.strictEqual(caught, observed);
    return caught.code === 'TEMP_CHILD_FAILED';
  });
  assert.deepEqual(ownedTempUsage(), baseline);
});
test('staged identity observer handles an already-settled raw profile failure promptly', async () => {
  const baseline = ownedTempUsage();
  let rawFailure = null;
  await assert.rejects(withOwnedWorkspace(ownedSpec('owned-report-observer-already-settled'), async (lease) => {
    await writeJson(lease, 'workspace', sourceLockRel, activeLock());
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const harness = pausedReportStage(lease, apiBaseUrl);
      try {

        await assert.rejects(harness.profilePromise, (caught) => {
          rawFailure = caught;
          return caught.code === 'TEMP_CHILD_FAILED';
        });
        const startedAt = Date.now();
        await assert.rejects(waitForTestBarrier(harness, 'staged report async boundary'), (caught) => caught === rawFailure);
        assert.ok(Date.now() - startedAt < 1000);
        assert.equal(harness.events().some((event) => event.type === 'barrier'), false);
      } finally {
        harness.release();
        await harness.completion;
        harness.restore();
      }
    }, 500);
  }), (caught) => {
    assert.strictEqual(caught, rawFailure);
    return caught.code === 'TEMP_CHILD_FAILED';
  });
  assert.deepEqual(ownedTempUsage(), baseline);
});
test('staged identity observer releases its broker gate after child termination and preserves the first failure', async () => {
  const baseline = ownedTempUsage();
  let terminalFailure = null;
  await assert.rejects(withOwnedWorkspace(ownedSpec('owned-report-observer-terminal-during-gate'), async (lease) => {
    await writeJson(lease, 'workspace', sourceLockRel, activeLock());
    await lease.writeFile('workspace/repo/source-watch/reviews/active-third-party-updates.md', 'prior report');
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const harness = pausedReportStage(lease, apiBaseUrl);
      try {
        await waitForTestBarrier(harness, 'staged report async boundary');
        const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
        const leasePath = path.join(path.dirname(path.dirname(lease.root)), 'claims', row.claimId + '.lease.json');
        const liveLease = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
        assert.equal(liveLease.owned_children.length, 1);
        process.kill(liveLease.owned_children[0].pid, 'SIGTERM');
        const outcome = await harness.completion;
        assert.equal(outcome.status, 'rejected');
        terminalFailure = outcome.error;
        assert.equal(outcome.error.code, 'TEMP_CHILD_DISCONNECTED_BEFORE_ACK');
        assert.equal(harness.gateReleased(), true);
        assert.equal(harness.destinationMutations(), 1);
        const events = harness.events();
        const barrierEvent = events.find((event) => event.type === 'barrier');
        const terminalEvent = events.find((event) => event.type === 'child-disconnect' || event.type === 'child-close');
        assert.ok(barrierEvent && terminalEvent);
        assert.ok(barrierEvent.order < terminalEvent.order);
        assert.notEqual(fs.readFileSync(harness.destination, 'utf8'), 'prior report');
        const settledLease = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
        assert.deepEqual(settledLease.owned_children, []);
      } finally {
        harness.release();
        await harness.completion;
        harness.restore();
      }
    });
  }), (caught) => {
    assert.strictEqual(caught, terminalFailure);
    return caught.code === 'TEMP_CHILD_DISCONNECTED_BEFORE_ACK';
  });
  assert.deepEqual(ownedTempUsage(), baseline);
});
test('owned report broker preserves staged identity across an async boundary and waits for parent write completion', async () => {
  await withOwnedWorkspace(ownedSpec('owned-report-stage-identity-preserved'), async (lease) => {
    await writeJson(lease, 'workspace', sourceLockRel, activeLock());
    await lease.writeFile('workspace/repo/source-watch/reviews/active-third-party-updates.md', 'prior report');
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const harness = pausedReportStage(lease, apiBaseUrl);
      try {
        await waitForTestBarrier(harness, 'staged report async boundary');
        assert.equal(harness.completionSettled(), false);
        assert.ok(fs.existsSync(harness.stagePath()));
        const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
        const leasePath = path.join(path.dirname(path.dirname(lease.root)), 'claims', row.claimId + '.lease.json');
        assert.equal(JSON.parse(fs.readFileSync(leasePath, 'utf8')).owned_children.length, 1);
        harness.release();
        const outcome = await harness.completion;
        assert.equal(outcome.status, 'resolved', outcome.error && outcome.error.message);
        assert.equal(outcome.value.code, 0, outcome.value.stderr);
        assert.equal(harness.destinationMutations(), 1);
        assert.notEqual(fs.readFileSync(harness.destination, 'utf8'), 'prior report');
      } finally {
        harness.release();
        harness.restore();
      }
    });
  });
});

test('owned report broker rejects a replaced staged file before parent commit with no direct-write fallback', async () => {
  await assertRejectedStageMutation('owned-report-stage-replaced', ({ stagePath, harness }) => {
    harness.originalWriteFile(stagePath, 'foreign replacement', 'utf8');
  });
});

test('owned report broker rejects a removed staged file before parent commit', async () => {
  await assertRejectedStageMutation('owned-report-stage-removed', () => {});
});

test('owned report broker rejects same-path same-payload replacement identity before parent commit', async () => {
  await assertRejectedStageMutation('owned-report-stage-identical-replacement', ({ stagePath, originalPayload, harness }) => {
    harness.originalWriteFile(stagePath, originalPayload);
  });
});

test('owned report broker waits for parent REMOVE_REPORT completion before success', async () => {
  await withOwnedWorkspace(ownedSpec('owned-report-remove-completion'), async (lease) => {
    await writeJson(lease, 'workspace', sourceLockRel, activeLock(lockedSha));
    await lease.writeFile('workspace/repo/source-watch/reviews/active-third-party-updates.md', 'prior report');
    await withMockGitHub(lockedSha, async (apiBaseUrl) => {
      const originalLstat = fs.promises.lstat;
      const destination = lease.path('workspace/repo/source-watch/reviews/active-third-party-updates.md');
      let enteredResolve;
      let releaseResolve;
      let entered = false;
      let settled = false;
      let released = false;
      const boundary = new Promise((resolve) => { enteredResolve = resolve; });
      const gate = new Promise((resolve) => { releaseResolve = () => { if (!released) { released = true; resolve(); } }; });
      fs.promises.lstat = async function (filePath, ...args) {
        if (!entered && path.resolve(String(filePath)) === path.resolve(destination)) {
          entered = true;
          enteredResolve();
          await gate;
        }
        return originalLstat.call(this, filePath, ...args);
      };
      const completion = runScript(lease, 'workspace', apiBaseUrl).then(
        (value) => { settled = true; return { status: 'resolved', value }; },
        (error) => { settled = true; return { status: 'rejected', error }; }
      );
      try {
        await waitForTestBarrier(boundary, 'parent REMOVE_REPORT async boundary');
        assert.equal(settled, false);
        const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
        const leasePath = path.join(path.dirname(path.dirname(lease.root)), 'claims', row.claimId + '.lease.json');
        assert.equal(JSON.parse(fs.readFileSync(leasePath, 'utf8')).owned_children.length, 1);
        assert.equal(fs.readFileSync(destination, 'utf8'), 'prior report');
        releaseResolve();
        const outcome = await completion;
        assert.equal(outcome.status, 'resolved', outcome.error && outcome.error.message);
        assert.equal(outcome.value.code, 0, outcome.value.stderr);
        assert.equal(fs.existsSync(destination), false);
      } finally {
        releaseResolve();
        fs.promises.lstat = originalLstat;
      }
    });
  });
});

test('owned report broker rejects redirected staged resources before parent commit', async (t) => {
  let foreignPath = null;
  if (process.platform === 'win32') {
    const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'w2a-report-link-probe-'));
    const target = path.join(probeRoot, 'target');
    const link = path.join(probeRoot, 'link');
    try {
      fs.mkdirSync(target);
      try { fs.symlinkSync(target, link, 'junction'); }
      catch (caught) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes(caught.code)) {
          t.skip('This Windows owner context cannot create the junction needed for the redirection fault injection.');
          return;
        }
        throw caught;
      }
    } finally {
      if (fs.existsSync(link)) fs.rmdirSync(link);
      if (fs.existsSync(target)) fs.rmdirSync(target);
      if (fs.existsSync(probeRoot)) fs.rmdirSync(probeRoot);
    }
  }
  await assertRejectedStageMutation('owned-report-stage-redirected', ({ stagePath, harness }) => {
    foreignPath = stagePath + '.foreign';
    if (process.platform === 'win32') {
      fs.mkdirSync(foreignPath);
      harness.originalWriteFile(path.join(foreignPath, 'foreign.txt'), 'foreign resource', 'utf8');
      fs.symlinkSync(foreignPath, stagePath, 'junction');
    } else {
      harness.originalWriteFile(foreignPath, 'foreign resource', 'utf8');
      fs.symlinkSync(foreignPath, stagePath);
    }
  }, ({ harness }) => {
    if (!foreignPath) return;
    if (process.platform === 'win32') {
      const foreignFile = path.join(foreignPath, 'foreign.txt');
      if (fs.existsSync(foreignFile)) harness.originalUnlink(foreignFile);
      if (fs.existsSync(foreignPath)) harness.originalRmdir(foreignPath);
    } else if (fs.existsSync(foreignPath)) harness.originalUnlink(foreignPath);
    foreignPath = null;
  });
});
test('standalone source-update CLI retains caller-selected report behavior', async () => {
  await withWorkspace('source-update-standalone', async (lease, workspace) => {
    await writeJson(lease, workspace, sourceLockRel, activeLock());
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const result = await runStandaloneScript([
        scriptPath, '--workspace', lease.path(workspace), '--report', 'standalone-review.md'
      ], {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, SOURCE_WATCH_GITHUB_API_BASE_URL: apiBaseUrl, GITHUB_TOKEN: '' }
      });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('Wrote standalone-review.md'));
      const report = fs.readFileSync(lease.path(path.join(workspace, 'standalone-review.md')), 'utf8');
      assert.ok(report.includes('This PR is a review notification only.'));
    });
  });
});

test('low capacity refuses before source-update fixture construction', async () => {
  const baseline = ownedTempUsage();
  const original = fs.statfsSync;
  let fixtureConstructed = false;
  fs.statfsSync = () => ({ bavail: 0n, bsize: 1n });
  try {
    await assert.rejects(
      withOwnedTemp(ownedSpec('source-update-low-space'), async (lease) => {
        fixtureConstructed = true;
        await lease.mkdir('workspace');
        await writeJson(lease, 'workspace', sourceLockRel, activeLock());
      }),
      (error) => error && error.code === 'TEMP_CAPACITY_LOW'
    );
  } finally {
    fs.statfsSync = original;
  }
  assert.equal(fixtureConstructed, false);
  assert.deepEqual(ownedTempUsage(), baseline);
});

test('canonical source-watch provenance with no upstream drift produces no report', async () => {
  await withWorkspace('source-update-no-drift', async (lease, workspace) => {
    await writeJson(lease, workspace, sourceLockRel, activeLock());
    await withMockGitHub(lockedSha, async (apiBaseUrl, requests) => {
      const result = await runScript(lease, workspace, apiBaseUrl);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /no actionable updates found/i);
      assert.equal(fs.existsSync(lease.path(path.join(workspace, 'repo/source-watch/reviews/active-third-party-updates.md'))), false);
      assert.deepEqual(requests, ['/repos/example-owner/example-repo/commits/main']);
    });
  });
});

test('upstream drift produces a review-only notification without changing the lock', async () => {
  await withWorkspace('source-update-drift', async (lease, workspace) => {
    const lockPath = path.join(workspace, sourceLockRel);
    await writeJson(lease, workspace, sourceLockRel, activeLock());
    const before = fs.readFileSync(lease.path(lockPath), 'utf8');
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const result = await runScript(lease, workspace, apiBaseUrl);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /PR needed: yes/);
    });
    const report = fs.readFileSync(lease.path(path.join(workspace, 'repo/source-watch/reviews/active-third-party-updates.md')), 'utf8');
    assert.match(report, /This PR is a review notification only\./);
    assert.match(report, /No SOURCE-LOCK pins were changed\./);
    assert.match(report, /No upstream code was executed\./);
    assert.match(report, new RegExp('Adopted commit: .' + lockedSha));
    assert.match(report, new RegExp('Latest observed commit: .' + latestSha));
    assert.equal(fs.readFileSync(lease.path(lockPath), 'utf8'), before);
  });
});

test('human reviewed-through cursor suppresses an already reviewed upstream commit', async () => {
  await withWorkspace('source-update-reviewed-cursor', async (lease, workspace) => {
    await writeJson(lease, workspace, sourceLockRel, activeLock());
    await writeJson(lease, workspace, 'repo/source-watch/review-state.json', reviewStateDoc(latestSha));
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const result = await runScript(lease, workspace, apiBaseUrl);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /no actionable updates found/i);
    });
  });
});

test('retired migration provenance is ignored and never queried upstream', async () => {
  await withWorkspace('source-update-retired-provenance', async (lease, workspace) => {
    await writeJson(lease, workspace, 'repo/source-watch/provenance/retired/SOURCE-LOCK.json', retiredLock());
    await withMockGitHub(latestSha, async (apiBaseUrl, requests) => {
      const result = await runScript(lease, workspace, apiBaseUrl);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /No active third-party source update candidates found/);
      assert.deepEqual(requests, []);
    });
  });
});

test('invalid active source-watch metadata fails closed before any upstream request', async () => {
  const baseline = ownedTempUsage();
  await assert.rejects(withWorkspace('source-update-invalid-metadata', async (lease, workspace) => {
    const invalid = activeLock();
    invalid.source_update_policy = 'none';
    await writeJson(lease, workspace, sourceLockRel, invalid);
    await withMockGitHub(latestSha, async (apiBaseUrl, requests) => {
      const result = await runScript(lease, workspace, apiBaseUrl);
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /Unsupported SOURCE-LOCK lifecycle metadata/);
      assert.deepEqual(requests, []);
    });
  }), (caught) => {
    assert.equal(caught.code, 'TEMP_CHILD_FAILED');
    assert.match(caught.stderr, /Unsupported SOURCE-LOCK lifecycle metadata/);
    return true;
  });
  assert.deepEqual(ownedTempUsage(), baseline);
});
test('review-state source-lock identities bind to canonical provenance paths', () => {
  const record = reviewState.validateRecord(reviewStateDoc(latestSha).records[0], 0);
  assert.equal(record.target_key, 'source-lock:' + sourceProjectRel);
  assert.equal(record.source_lock_path, sourceLockRel);
});
