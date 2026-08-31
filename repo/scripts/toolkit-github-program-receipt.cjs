#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { canonicalSerialize, digestValue } = require('./toolkit-execution-loop.cjs');

const SCHEMA_ID = 'toolkit.github-program.run-receipt.v1';
const MIN_NODE_VERSION = '22.13.0';
const APPLICATION_ID = 1196446257;
const USER_VERSION = 1;
const BUSY_TIMEOUT_MS = 5000;
const RECEIPT_TYPES = Object.freeze([
  'RUN_STARTED',
  'TRANSITION_PREVIEW',
  'EXECUTOR_TERMINAL',
  'G4_TERMINAL',
  'RUN_INTERRUPTED'
]);
const TERMINAL_TYPES = Object.freeze(['EXECUTOR_TERMINAL', 'G4_TERMINAL', 'RUN_INTERRUPTED']);
const LIMITS = Object.freeze({
  receiptBytes: 16 * 1024,
  payloadBytes: 8 * 1024,
  receiptsPerRun: 128,
  allocationsPerNamespace: 10000,
  databaseBytes: 64 * 1024 * 1024,
  leaseMinMs: 1000,
  leaseMaxMs: 24 * 60 * 60 * 1000
});
const RECEIPT_KEYS = Object.freeze([
  'schema', 'receipt_type', 'receipt_id', 'sequence', 'prior_receipt_id',
  'run_id', 'allocation_id', 'repository', 'parent_issue', 'child_issue',
  'lock', 'authority', 'start', 'candidate', 'lease', 'payload', 'created_at'
]);
const AUTHORITY_KEYS = Object.freeze([
  'child_comment_id', 'parent_comment_id', 'node_id', 'author_login',
  'author_association', 'body_digest', 'updated_at', 'update_identity_digest',
  'scope_digest'
]);
const START_KEYS = Object.freeze([
  'base_sha', 'head_sha', 'tree_sha', 'status_digest', 'clean_worktree', 'ref'
]);
const CANDIDATE_KEYS = Object.freeze([
  'pr_number', 'branch', 'base_ref', 'base_sha', 'head_sha', 'tree_sha'
]);
const LEASE_KEYS = Object.freeze([
  'lease_id', 'fence_id', 'fence_sequence', 'issued_at', 'expires_at'
]);
const PAYLOAD_KEYS = Object.freeze([
  'classification', 'reason_code', 'outcome_digest', 'evidence_digest',
  'operation_digest', 'detail_digest', 'mutation_outcome', 'evidence_refs'
]);
const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|private[_-]?key|secret|token|prompt|upload|model[_-]?output|raw[_-]?body)/i;
const SENSITIVE_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+\/-]+=*|github_pat_[A-Za-z0-9_]{20,}|gh[opusr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;
const SESSION_OWNERS = new WeakMap();

class GprError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'GprError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, details) {
  throw new GprError(code, details);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

function isSafeId(value, max = 160) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && /^[A-Za-z0-9._:/-]+$/.test(value)
    && !value.startsWith('-')
    && !value.includes('..');
}

function isSafeGitRef(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 240
    && !value.startsWith('-')
    && !value.startsWith('/')
    && !value.endsWith('/')
    && !value.endsWith('.')
    && !value.includes('..')
    && !value.includes('@{')
    && value !== '@'
    && !/[\u0000-\u0020\u007f~^:?*\\[]/.test(value)
    && value.split('/').every((component) => component.length > 0 && !component.startsWith('.') && !component.endsWith('.lock'));
}

function isTimestamp(value) {
  if (typeof value !== 'string' || value.length > 32) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isoAt(value = Date.now()) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) fail('GPR_TIMESTAMP_INVALID');
  return new Date(time).toISOString();
}

function assertPrivacySafe(value, seen = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return;
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE.test(value)) fail('GPR_SENSITIVE_VALUE');
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) fail('GPR_VALUE_INVALID');
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertPrivacySafe(item, seen);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) fail('GPR_SENSITIVE_FIELD', { field: key });
      assertPrivacySafe(item, seen);
    }
  }
  seen.delete(value);
}

function byteLength(value) {
  return Buffer.byteLength(canonicalSerialize(value), 'utf8');
}

function compareVersions(left, right) {
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (!Number.isInteger(a[index]) || a[index] < 0) return -1;
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function assertRuntimeSupport(options = {}) {
  const nodeVersion = options.nodeVersion || process.versions.node;
  if (compareVersions(nodeVersion, MIN_NODE_VERSION) < 0) {
    fail('GPR_UNSUPPORTED_RUNTIME', { required: MIN_NODE_VERSION, observed: nodeVersion });
  }
  let sqlite = options.sqlite;
  if (!sqlite) {
    try {
      sqlite = require('node:sqlite');
    } catch (error) {
      fail('GPR_SQLITE_UNAVAILABLE', { cause: error && error.code ? error.code : 'load-failed' });
    }
  }
  if (!sqlite || typeof sqlite.DatabaseSync !== 'function') fail('GPR_SQLITE_UNAVAILABLE');
  return sqlite;
}

function validateRepository(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value)) {
    fail('GPR_REPOSITORY_INVALID');
  }
  return value.toLowerCase();
}

function validateIssue(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) fail('GPR_NAMESPACE_INVALID', { field: name });
  return value;
}

function validateAuthority(value) {
  if (!exactKeys(value, AUTHORITY_KEYS)) fail('GPR_AUTHORITY_INVALID');
  validateIssue(value.child_comment_id, 'child_comment_id');
  validateIssue(value.parent_comment_id, 'parent_comment_id');
  if (!isSafeId(value.node_id) || !/^[A-Za-z0-9-]{1,39}$/.test(value.author_login || '')) fail('GPR_AUTHORITY_INVALID');
  if (value.author_association !== 'OWNER' || !isTimestamp(value.updated_at)) fail('GPR_AUTHORITY_INVALID');
  for (const key of ['body_digest', 'update_identity_digest', 'scope_digest']) {
    if (!isDigest(value[key])) fail('GPR_AUTHORITY_INVALID', { field: key });
  }
  assertPrivacySafe(value);
  return clone(value);
}

function validateStart(value) {
  if (!exactKeys(value, START_KEYS)) fail('GPR_START_INVALID');
  for (const key of ['base_sha', 'head_sha', 'tree_sha']) if (!isSha(value[key])) fail('GPR_START_INVALID', { field: key });
  if (!isDigest(value.status_digest) || value.clean_worktree !== true) fail('GPR_START_INVALID');
  if (!exactKeys(value.ref, ['detached', 'name']) || typeof value.ref.detached !== 'boolean') fail('GPR_START_INVALID');
  if (value.ref.detached) {
    if (value.ref.name !== null) fail('GPR_START_INVALID');
  } else if (!isSafeGitRef(value.ref.name)) {
    fail('GPR_START_INVALID');
  }
  assertPrivacySafe(value);
  return clone(value);
}

function validateCandidate(value) {
  if (!exactKeys(value, CANDIDATE_KEYS)) fail('GPR_CANDIDATE_INVALID');
  validateIssue(value.pr_number, 'pr_number');
  if (!isSafeGitRef(value.branch) || !isSafeGitRef(value.base_ref)) fail('GPR_CANDIDATE_INVALID');
  for (const key of ['base_sha', 'head_sha', 'tree_sha']) if (!isSha(value[key])) fail('GPR_CANDIDATE_INVALID', { field: key });
  assertPrivacySafe(value);
  return clone(value);
}

function validatePayload(value) {
  if (!isRecord(value)) fail('GPR_PAYLOAD_INVALID');
  assertPrivacySafe(value);
  if (!Object.keys(value).every((key) => PAYLOAD_KEYS.includes(key))
    || !isSafeId(value.classification)) fail('GPR_PAYLOAD_INVALID');
  if (value.reason_code !== undefined && !isSafeId(value.reason_code)) fail('GPR_PAYLOAD_INVALID');
  for (const key of ['outcome_digest', 'evidence_digest', 'operation_digest', 'detail_digest']) {
    if (value[key] !== undefined && !isDigest(value[key])) fail('GPR_PAYLOAD_INVALID', { field: key });
  }
  if (value.mutation_outcome !== undefined && !['KNOWN', 'UNKNOWN'].includes(value.mutation_outcome)) fail('GPR_PAYLOAD_INVALID');
  if (value.evidence_refs !== undefined) {
    if (!Array.isArray(value.evidence_refs) || value.evidence_refs.length > 50) fail('GPR_PAYLOAD_INVALID');
    for (const item of value.evidence_refs) {
      if (!exactKeys(item, ['id', 'digest']) || !isSafeId(item.id) || !isDigest(item.digest)) fail('GPR_PAYLOAD_INVALID');
    }
  }
  if (byteLength(value) > LIMITS.payloadBytes) fail('GPR_RECEIPT_TOO_LARGE');
  return clone(value);
}

function validateLease(value) {
  if (!exactKeys(value, LEASE_KEYS)) fail('GPR_LEASE_INVALID');
  if (!isSafeId(value.lease_id) || !isSafeId(value.fence_id)) fail('GPR_LEASE_INVALID');
  if (!Number.isSafeInteger(value.fence_sequence) || value.fence_sequence < 1) fail('GPR_LEASE_INVALID');
  if (!isTimestamp(value.issued_at) || !isTimestamp(value.expires_at) || Date.parse(value.expires_at) <= Date.parse(value.issued_at)) {
    fail('GPR_LEASE_INVALID');
  }
  return clone(value);
}

function receiptPayload(receipt) {
  const payload = clone(receipt);
  delete payload.receipt_id;
  return payload;
}

function validateReceiptObject(value) {
  if (!exactKeys(value, RECEIPT_KEYS)) fail('GPR_RECEIPT_INVALID');
  if (value.schema !== SCHEMA_ID || !RECEIPT_TYPES.includes(value.receipt_type)) fail('GPR_RECEIPT_INVALID');
  if (!isDigest(value.receipt_id) || value.receipt_id !== digestValue(receiptPayload(value))) fail('GPR_RECEIPT_TAMPERED');
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > LIMITS.receiptsPerRun) fail('GPR_SEQUENCE_INVALID');
  if (value.prior_receipt_id !== null && !isDigest(value.prior_receipt_id)) fail('GPR_CHAIN_BROKEN');
  if (!isSafeId(value.run_id) || !isSafeId(value.allocation_id) || !isSafeId(value.lock)) fail('GPR_RECEIPT_INVALID');
  if (validateRepository(value.repository) !== value.repository) fail('GPR_REPOSITORY_INVALID');
  validateIssue(value.parent_issue, 'parent_issue');
  validateIssue(value.child_issue, 'child_issue');
  validateAuthority(value.authority);
  validateStart(value.start);
  if (value.candidate !== null) validateCandidate(value.candidate);
  validateLease(value.lease);
  validatePayload(value.payload);
  if (byteLength(value) > LIMITS.receiptBytes) fail('GPR_RECEIPT_TOO_LARGE');
  if (!isTimestamp(value.created_at) || Date.parse(value.created_at) < Date.parse(value.lease.issued_at)) fail('GPR_RECEIPT_INVALID');
  if (value.sequence === 1) {
    if (value.receipt_type !== 'RUN_STARTED' || value.prior_receipt_id !== null || value.candidate !== null) fail('GPR_RUN_STARTED_INVALID');
  } else if (value.receipt_type === 'RUN_STARTED' || value.prior_receipt_id === null) {
    fail('GPR_CHAIN_BROKEN');
  }
  return deepFreeze(clone(value));
}

function sameBinding(left, right) {
  return left.repository === right.repository
    && left.parent_issue === right.parent_issue
    && left.child_issue === right.child_issue
    && left.lock === right.lock
    && left.run_id === right.run_id
    && left.allocation_id === right.allocation_id
    && canonicalSerialize(left.authority) === canonicalSerialize(right.authority)
    && canonicalSerialize(left.start) === canonicalSerialize(right.start)
    && canonicalSerialize(left.lease) === canonicalSerialize(right.lease);
}

function validateReceiptChain(receipts) {
  if (!Array.isArray(receipts) || receipts.length < 1 || receipts.length > LIMITS.receiptsPerRun) fail('GPR_CHAIN_INVALID');
  const validated = receipts.map(validateReceiptObject);
  const ids = new Set();
  let candidate = null;
  let terminal = false;
  for (let index = 0; index < validated.length; index += 1) {
    const receipt = validated[index];
    if (ids.has(receipt.receipt_id)) fail('GPR_RECEIPT_DUPLICATE');
    ids.add(receipt.receipt_id);
    if (receipt.sequence !== index + 1) fail('GPR_SEQUENCE_REGRESSION');
    if (index > 0) {
      const prior = validated[index - 1];
      if (receipt.prior_receipt_id !== prior.receipt_id || !sameBinding(receipt, prior)) fail('GPR_CHAIN_BROKEN');
      if (Date.parse(receipt.created_at) < Date.parse(prior.created_at)) fail('GPR_RECEIPT_CHRONOLOGY_INVALID');
      if (terminal) fail('GPR_RUN_TERMINAL');
      if (candidate === null && receipt.candidate !== null) {
        if (receipt.receipt_type !== 'TRANSITION_PREVIEW') fail('GPR_CANDIDATE_INTRODUCTION_INVALID');
        candidate = receipt.candidate;
      } else if (candidate !== null && canonicalSerialize(receipt.candidate) !== canonicalSerialize(candidate)) {
        fail('GPR_CANDIDATE_CHANGED');
      } else if (candidate === null && receipt.candidate !== null) {
        candidate = receipt.candidate;
      }
    }
    if (TERMINAL_TYPES.includes(receipt.receipt_type)) terminal = true;
  }
  return deepFreeze(validated.map(clone));
}

function namespaceValue(options) {
  return Object.freeze({
    repository: validateRepository(options.repository),
    parent_issue: validateIssue(options.parent_issue, 'parent_issue'),
    child_issue: validateIssue(options.child_issue, 'child_issue')
  });
}

function namespaceDigest(namespace) {
  return digestValue({ schema: SCHEMA_ID, ...namespace });
}

function isWithin(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function assertNoSymlinkComponents(inputPath) {
  let current = path.resolve(inputPath);
  while (true) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail('GPR_UNSAFE_STATE_ROOT', { reason: 'symlink-or-reparse' });
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function hasGitWorktreeAncestor(inputPath) {
  let current = path.resolve(inputPath);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function stateAnchor() {
  return path.resolve(os.homedir(), '.ai-agent-toolkit', 'user-state', 'github-program-receipt');
}

function validateWindowsStorageProof(acl) {
  if (!acl || typeof acl.current !== 'string' || acl.owner !== acl.current
    || acl.drive_type !== 3 || !Array.isArray(acl.rules)) {
    fail('GPR_UNSAFE_STATE_ROOT', { reason: 'acl-owner-or-drive' });
  }
  const trusted = new Set([acl.current, 'S-1-5-18', 'S-1-5-32-544']);
  if (acl.rules.some((rule) => !isRecord(rule) || rule.type === 'Allow' && !trusted.has(rule.sid))) {
    fail('GPR_UNSAFE_STATE_ROOT', { reason: 'acl-untrusted-access' });
  }
  return true;
}

function verifyWindowsPrivateAcl(stateRoot) {
  const systemRoot = process.env.SystemRoot;
  const powershell = systemRoot && path.resolve(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!powershell || !path.isAbsolute(powershell) || !fs.existsSync(powershell)
    || !fs.lstatSync(powershell).isFile() || fs.lstatSync(powershell).isSymbolicLink()) {
    fail('GPR_UNSAFE_STATE_ROOT', { reason: 'acl-tool-unproven' });
  }
  const script = [
    '$ErrorActionPreference="Stop"',
    '$acl=Get-Acl -LiteralPath $env:GPR_ACL_PATH',
    '$current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '$owner=(New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value',
    '$rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object { [pscustomobject]@{ sid=$_.IdentityReference.Value; type=[string]$_.AccessControlType; rights=[string]$_.FileSystemRights } })',
    '$root=[System.IO.Path]::GetPathRoot($env:GPR_ACL_PATH)',
    'if ($root -notmatch "^[A-Za-z]:\\\\$") { throw "non-local-root" }',
    '$device=$root.Substring(0,2)',
    '$disk=Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID=\'"+$device+"\'")',
    'if ($null -eq $disk) { throw "drive-unproven" }',
    '[pscustomobject]@{ current=$current; owner=$owner; drive_type=[int]$disk.DriveType; rules=$rules } | ConvertTo-Json -Compress -Depth 4'
  ].join(';');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: { ...process.env, GPR_ACL_PATH: stateRoot }
  });
  if (result.status !== 0 || !result.stdout) fail('GPR_UNSAFE_STATE_ROOT', { reason: 'acl-unproven' });
  let acl;
  try { acl = JSON.parse(result.stdout); } catch (_) { fail('GPR_UNSAFE_STATE_ROOT', { reason: 'acl-unproven' }); }
  validateWindowsStorageProof(acl);
}

function assertSafeStateRoot(options) {
  if (typeof options.stateRoot !== 'string' || !path.isAbsolute(options.stateRoot)) fail('GPR_UNSAFE_STATE_ROOT', { reason: 'absolute-required' });
  if (typeof options.repositoryRoot !== 'string' || !path.isAbsolute(options.repositoryRoot)) fail('GPR_UNSAFE_STATE_ROOT', { reason: 'repository-root-required' });
  const stateRoot = path.resolve(options.stateRoot);
  const repositoryRoot = path.resolve(options.repositoryRoot);
  for (const target of [stateRoot, repositoryRoot]) {
    if (!fs.existsSync(target) || !fs.lstatSync(target).isDirectory()) fail('GPR_UNSAFE_STATE_ROOT', { reason: 'existing-directory-required' });
    assertNoSymlinkComponents(target);
    if (fs.realpathSync.native(target) !== target) fail('GPR_UNSAFE_STATE_ROOT', { reason: 'unproven-realpath' });
  }
  const tempRoot = fs.realpathSync.native(path.resolve(os.tmpdir()));
  const anchor = stateAnchor();
  if ((process.platform === 'win32' && (stateRoot.startsWith('\\\\') || anchor.startsWith('\\\\')))
    || !isWithin(stateRoot, anchor)
    || isWithin(stateRoot, repositoryRoot)
    || isWithin(stateRoot, tempRoot)
    || hasGitWorktreeAncestor(stateRoot)) {
    fail('GPR_UNSAFE_STATE_ROOT', { reason: 'forbidden-location' });
  }
  if (process.platform === 'win32') verifyWindowsPrivateAcl(stateRoot);
  else {
    const stat = fs.statSync(stateRoot);
    if (typeof process.getuid !== 'function' || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
      fail('GPR_UNSAFE_STATE_ROOT', { reason: 'private-permissions-required' });
    }
  }
  return stateRoot;
}

function resolveDatabasePath(options) {
  const namespace = namespaceValue(options);
  const stateRoot = assertSafeStateRoot(options);
  return path.join(stateRoot, `github-program-receipt-${namespaceDigest(namespace)}.sqlite`);
}

const SCHEMA_SQL = `
CREATE TABLE metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_id TEXT NOT NULL,
  namespace_digest TEXT NOT NULL,
  repository TEXT NOT NULL,
  parent_issue INTEGER NOT NULL,
  child_issue INTEGER NOT NULL,
  schema_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE coordination_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  high_water INTEGER NOT NULL CHECK (high_water >= 0)
) STRICT;
CREATE TABLE allocations (
  allocation_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  lock_id TEXT NOT NULL,
  lease_id TEXT NOT NULL UNIQUE,
  fence_id TEXT NOT NULL UNIQUE,
  fence_sequence INTEGER NOT NULL UNIQUE,
  owner_instance_id TEXT NOT NULL,
  process_id INTEGER NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  authority_json TEXT NOT NULL,
  start_json TEXT NOT NULL,
  allocation_digest TEXT NOT NULL
) STRICT;
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  allocation_id TEXT NOT NULL UNIQUE REFERENCES allocations(allocation_id),
  lock_id TEXT NOT NULL,
  authority_digest TEXT NOT NULL,
  start_digest TEXT NOT NULL,
  run_digest TEXT NOT NULL
) STRICT;
CREATE TABLE receipts (
  receipt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  sequence INTEGER NOT NULL,
  receipt_type TEXT NOT NULL,
  prior_receipt_id TEXT REFERENCES receipts(receipt_id),
  canonical_json TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  UNIQUE (run_id, sequence)
) STRICT;
CREATE TABLE lease_events (
  event_id TEXT PRIMARY KEY,
  allocation_id TEXT NOT NULL REFERENCES allocations(allocation_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('ALLOCATED', 'EXPIRED_TAKEOVER', 'RELEASED')),
  fence_sequence INTEGER NOT NULL,
  event_at TEXT NOT NULL,
  detail_digest TEXT NOT NULL,
  event_digest TEXT NOT NULL
) STRICT;
CREATE INDEX receipts_run_sequence ON receipts(run_id, sequence);
CREATE INDEX lease_events_allocation ON lease_events(allocation_id, fence_sequence);
CREATE TRIGGER metadata_no_update BEFORE UPDATE ON metadata BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER metadata_no_delete BEFORE DELETE ON metadata BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER coordination_high_water_cas BEFORE UPDATE ON coordination_state
  WHEN NEW.singleton != OLD.singleton OR NEW.high_water != OLD.high_water + 1
  BEGIN SELECT RAISE(ABORT, 'GPR_HIGH_WATER_CAS'); END;
CREATE TRIGGER coordination_no_delete BEFORE DELETE ON coordination_state BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER allocations_no_update BEFORE UPDATE ON allocations BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER allocations_no_delete BEFORE DELETE ON allocations BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER runs_no_update BEFORE UPDATE ON runs BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER runs_no_delete BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER receipts_no_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER lease_events_no_update BEFORE UPDATE ON lease_events BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER lease_events_no_delete BEFORE DELETE ON lease_events BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
`;

function oneValue(db, pragma, field) {
  const row = db.prepare(pragma).get();
  return row && row[field];
}

function configureDatabase(db) {
  db.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('PRAGMA trusted_schema=OFF');
  const journal = String(oneValue(db, 'PRAGMA journal_mode=DELETE', 'journal_mode') || '').toLowerCase();
  db.exec('PRAGMA synchronous=FULL');
  const pageSize = Number(oneValue(db, 'PRAGMA page_size', 'page_size'));
  const maxPages = Math.floor(LIMITS.databaseBytes / pageSize);
  db.exec(`PRAGMA max_page_count=${maxPages}`);
  if (journal !== 'delete'
    || Number(oneValue(db, 'PRAGMA synchronous', 'synchronous')) !== 2
    || Number(oneValue(db, 'PRAGMA foreign_keys', 'foreign_keys')) !== 1
    || Number(oneValue(db, 'PRAGMA trusted_schema', 'trusted_schema')) !== 0
    || Number(oneValue(db, 'PRAGMA busy_timeout', 'timeout')) !== BUSY_TIMEOUT_MS
    || !Number.isSafeInteger(pageSize) || pageSize < 512
    || Number(oneValue(db, 'PRAGMA max_page_count', 'max_page_count')) !== maxPages) {
    fail('GPR_SQLITE_POLICY_UNAVAILABLE');
  }
}

function schemaFingerprint(db) {
  const rows = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  return digestValue(rows);
}

let expectedSchemaFingerprintCache = null;

function expectedSchemaFingerprint(DatabaseSync) {
  if (expectedSchemaFingerprintCache) return expectedSchemaFingerprintCache;
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA trusted_schema=OFF');
    db.exec(SCHEMA_SQL);
    expectedSchemaFingerprintCache = schemaFingerprint(db);
    return expectedSchemaFingerprintCache;
  } finally {
    db.close();
  }
}

function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) { /* Preserve the original failure. */ }
    throw error;
  }
}

function createDatabase(db, namespace, digest, now, expectedFingerprint) {
  transaction(db, () => {
    db.exec(SCHEMA_SQL);
    db.exec(`PRAGMA application_id=${APPLICATION_ID}`);
    db.exec(`PRAGMA user_version=${USER_VERSION}`);
    const fingerprint = schemaFingerprint(db);
    if (fingerprint !== expectedFingerprint) fail('GPR_SCHEMA_MISMATCH');
    db.prepare('INSERT INTO metadata VALUES (1, ?, ?, ?, ?, ?, ?, ?)').run(
      SCHEMA_ID, digest, namespace.repository, namespace.parent_issue, namespace.child_issue, fingerprint, now
    );
    db.prepare('INSERT INTO coordination_state VALUES (1, 0)').run();
  });
}

function verifyRowDigests(db) {
  for (const row of db.prepare('SELECT * FROM allocations ORDER BY fence_sequence').all()) {
    let authority;
    let start;
    try {
      authority = JSON.parse(row.authority_json);
      start = JSON.parse(row.start_json);
    } catch (_) {
      fail('GPR_LEDGER_TAMPERED');
    }
    validateAuthority(authority);
    validateStart(start);
    const digest = digestValue({
      allocation_id: row.allocation_id,
      run_id: row.run_id,
      lock: row.lock_id,
      lease_id: row.lease_id,
      fence_id: row.fence_id,
      fence_sequence: row.fence_sequence,
      owner_instance_id: row.owner_instance_id,
      process_id: row.process_id,
      issued_at: row.issued_at,
      expires_at: row.expires_at,
      authority,
      start
    });
    if (digest !== row.allocation_digest) fail('GPR_ALLOCATOR_TAMPERED');
  }
  for (const row of db.prepare('SELECT * FROM runs ORDER BY run_id').all()) {
    if (row.run_digest !== digestValue({
      run_id: row.run_id,
      allocation_id: row.allocation_id,
      lock: row.lock_id,
      authority_digest: row.authority_digest,
      start_digest: row.start_digest
    })) fail('GPR_LEDGER_TAMPERED');
  }
  for (const row of db.prepare('SELECT * FROM lease_events ORDER BY fence_sequence, event_at, event_id').all()) {
    if (row.event_digest !== digestValue({
      event_id: row.event_id,
      allocation_id: row.allocation_id,
      event_type: row.event_type,
      fence_sequence: row.fence_sequence,
      event_at: row.event_at,
      detail_digest: row.detail_digest
    })) fail('GPR_LEDGER_TAMPERED');
  }
}

function readChainDb(db, runId, allowEmpty = false) {
  const rows = db.prepare('SELECT * FROM receipts WHERE run_id = ? ORDER BY sequence').all(runId);
  if (rows.length === 0) {
    if (allowEmpty) return [];
    fail('GPR_RUN_NOT_STARTED');
  }
  const receipts = rows.map((row) => {
    let receipt;
    try { receipt = JSON.parse(row.canonical_json); } catch (_) { fail('GPR_RECEIPT_TAMPERED'); }
    if (row.canonical_json !== canonicalSerialize(receipt)
      || row.receipt_id !== receipt.receipt_id
      || row.receipt_digest !== digestValue(receiptPayload(receipt))
      || row.receipt_digest !== receipt.receipt_id
      || row.sequence !== receipt.sequence
      || row.receipt_type !== receipt.receipt_type
      || row.prior_receipt_id !== receipt.prior_receipt_id) fail('GPR_RECEIPT_TAMPERED');
    return receipt;
  });
  return validateReceiptChain(receipts);
}

function verifyDatabase(db, namespace, digest, databasePath, expectedFingerprint) {
  if (fs.statSync(databasePath).size > LIMITS.databaseBytes) fail('GPR_DATABASE_LIMIT');
  if (Number(oneValue(db, 'PRAGMA application_id', 'application_id')) !== APPLICATION_ID
    || Number(oneValue(db, 'PRAGMA user_version', 'user_version')) !== USER_VERSION) fail('GPR_SCHEMA_MISMATCH');
  const metadata = db.prepare('SELECT * FROM metadata WHERE singleton = 1').get();
  if (!metadata
    || metadata.schema_id !== SCHEMA_ID
    || metadata.namespace_digest !== digest
    || metadata.repository !== namespace.repository
    || metadata.parent_issue !== namespace.parent_issue
    || metadata.child_issue !== namespace.child_issue
    || metadata.schema_fingerprint !== expectedFingerprint
    || schemaFingerprint(db) !== expectedFingerprint) fail('GPR_SCHEMA_MISMATCH');
  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') fail('GPR_INTEGRITY_CHECK_FAILED');
  if (db.prepare('PRAGMA foreign_key_check').all().length !== 0) fail('GPR_FOREIGN_KEY_CHECK_FAILED');
  const state = db.prepare('SELECT high_water FROM coordination_state WHERE singleton = 1').get();
  const max = db.prepare('SELECT COALESCE(MAX(fence_sequence), 0) AS value FROM allocations').get().value;
  if (!state || state.high_water !== max) fail('GPR_ALLOCATOR_TAMPERED');
  verifyRowDigests(db);
  const runIds = db.prepare('SELECT run_id FROM runs ORDER BY run_id').all();
  for (const row of runIds) readChainDb(db, row.run_id, true);
}

function openVerified(config, create = true) {
  assertRuntimeSupport();
  const databasePath = config.databasePath;
  const existed = fs.existsSync(databasePath);
  if (existed) {
    const stat = fs.lstatSync(databasePath);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync.native(databasePath) !== databasePath) fail('GPR_UNSAFE_STATE_FILE');
    if (stat.size > LIMITS.databaseBytes) fail('GPR_DATABASE_LIMIT');
  } else if (!create) {
    fail('GPR_STORE_NOT_FOUND');
  }
  const { DatabaseSync } = assertRuntimeSupport();
  const expectedFingerprint = expectedSchemaFingerprint(DatabaseSync);
  const db = new DatabaseSync(databasePath);
  try {
    configureDatabase(db);
    if (!existed) {
      createDatabase(db, config.namespace, config.namespaceDigest, isoAt(), expectedFingerprint);
      if (process.platform !== 'win32') fs.chmodSync(databasePath, 0o600);
    }
    verifyDatabase(db, config.namespace, config.namespaceDigest, databasePath, expectedFingerprint);
    return db;
  } catch (error) {
    try { db.close(); } catch (_) { /* Preserve the original failure. */ }
    if (error instanceof GprError) throw error;
    fail('GPR_STORE_INVALID', { cause: error && error.code ? error.code : 'sqlite-error' });
  }
}

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(16).toString('hex')}`;
}

function activeAllocationDb(db, now) {
  return db.prepare(`
    SELECT a.* FROM allocations a
    WHERE a.expires_at > ?
      AND NOT EXISTS (
        SELECT 1 FROM lease_events e
        WHERE e.allocation_id = a.allocation_id AND e.event_type = 'RELEASED'
      )
    ORDER BY a.fence_sequence DESC LIMIT 1
  `).get(now);
}

function latestAllocationDb(db) {
  return db.prepare('SELECT * FROM allocations ORDER BY fence_sequence DESC LIMIT 1').get();
}

function insertLeaseEvent(db, allocation, eventType, eventAt, detail) {
  const event = {
    event_id: randomId('event'),
    allocation_id: allocation.allocation_id,
    event_type: eventType,
    fence_sequence: allocation.fence_sequence,
    event_at: eventAt,
    detail_digest: digestValue(detail)
  };
  event.event_digest = digestValue(event);
  db.prepare('INSERT INTO lease_events VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    event.event_id, event.allocation_id, event.event_type, event.fence_sequence,
    event.event_at, event.detail_digest, event.event_digest
  );
  return event;
}

function allocationPublic(row) {
  return deepFreeze({
    allocation_id: row.allocation_id,
    run_id: row.run_id,
    lock: row.lock_id,
    lease: {
      lease_id: row.lease_id,
      fence_id: row.fence_id,
      fence_sequence: row.fence_sequence,
      issued_at: row.issued_at,
      expires_at: row.expires_at
    }
  });
}

function sessionState(store, session) {
  const state = session && SESSION_OWNERS.get(session);
  if (!state || state.storeInstanceId !== store.instanceId || state.processId !== process.pid) fail('GPR_OWNERSHIP_LOST');
  return state;
}

function allocationFromStateDb(db, state) {
  const row = db.prepare('SELECT * FROM allocations WHERE allocation_id = ?').get(state.allocationId);
  if (!row || row.run_id !== state.runId || row.owner_instance_id !== state.ownerInstanceId || row.process_id !== process.pid) fail('GPR_OWNERSHIP_LOST');
  return row;
}

function verifyFenceDb(db, state, now, options = {}) {
  const allocation = allocationFromStateDb(db, state);
  const highWater = db.prepare('SELECT high_water FROM coordination_state WHERE singleton = 1').get().high_water;
  if (highWater > allocation.fence_sequence) fail('GPR_NEWER_FENCE_EXISTS');
  if (highWater !== allocation.fence_sequence) fail('GPR_STALE_FENCE');
  const released = db.prepare("SELECT 1 AS value FROM lease_events WHERE allocation_id = ? AND event_type = 'RELEASED' LIMIT 1").get(allocation.allocation_id);
  if (released && !options.allowReleased) fail('GPR_STALE_FENCE');
  if (Date.parse(allocation.expires_at) <= Date.parse(now)) fail('GPR_EXPIRED_FENCE');
  return allocation;
}

function createReceipt(allocation, config, input) {
  const receipt = {
    schema: SCHEMA_ID,
    receipt_type: input.receipt_type,
    receipt_id: '',
    sequence: input.sequence,
    prior_receipt_id: input.prior_receipt_id,
    run_id: allocation.run_id,
    allocation_id: allocation.allocation_id,
    repository: config.namespace.repository,
    parent_issue: config.namespace.parent_issue,
    child_issue: config.namespace.child_issue,
    lock: allocation.lock_id,
    authority: JSON.parse(allocation.authority_json),
    start: JSON.parse(allocation.start_json),
    candidate: input.candidate,
    lease: {
      lease_id: allocation.lease_id,
      fence_id: allocation.fence_id,
      fence_sequence: allocation.fence_sequence,
      issued_at: allocation.issued_at,
      expires_at: allocation.expires_at
    },
    payload: clone(input.payload),
    created_at: input.created_at
  };
  receipt.receipt_id = digestValue(receiptPayload(receipt));
  return validateReceiptObject(receipt);
}

function appendReceiptInternal(store, session, input) {
  const state = sessionState(store, session);
  if (!isRecord(input) || !RECEIPT_TYPES.includes(input.receipt_type) || input.receipt_type === 'RUN_STARTED') fail('GPR_RECEIPT_INPUT_INVALID');
  if ('lease' in input || 'fence_id' in input || 'fence_sequence' in input || 'lease_id' in input) fail('GPR_CALLER_FENCE_FORBIDDEN');
  const createdAt = isoAt(input.created_at);
  const payload = validatePayload(input.payload);
  const observedAt = isoAt();
  if (Date.parse(createdAt) > Date.parse(observedAt)) fail('GPR_RECEIPT_CHRONOLOGY_INVALID');
  const db = openVerified(store.config);
  try {
    const allocation = allocationFromStateDb(db, state);
    const chain = readChainDb(db, state.runId);
    const prior = chain[chain.length - 1];
    if (Date.parse(createdAt) < Date.parse(allocation.issued_at)
      || Date.parse(createdAt) < Date.parse(prior.created_at)) fail('GPR_RECEIPT_CHRONOLOGY_INVALID');
    const repeatedCandidate = input.candidate === undefined ? prior.candidate : input.candidate;
    if (prior.receipt_type === input.receipt_type
      && prior.created_at === createdAt
      && canonicalSerialize(prior.payload) === canonicalSerialize(payload)
      && canonicalSerialize(prior.candidate) === canonicalSerialize(repeatedCandidate)) {
      return deepFreeze({ receipt: prior, duplicate: true });
    }
    if (TERMINAL_TYPES.includes(prior.receipt_type)) fail('GPR_RUN_TERMINAL');
    const sequence = prior.sequence + 1;
    if (input.sequence !== undefined && input.sequence !== sequence) fail('GPR_SEQUENCE_CONFLICT');
    if (input.prior_receipt_id !== undefined && input.prior_receipt_id !== prior.receipt_id) fail('GPR_CHAIN_CONFLICT');
    let candidate = prior.candidate;
    if (input.candidate !== undefined) {
      if (input.candidate === null) candidate = null;
      else candidate = validateCandidate(input.candidate);
    }
    const receipt = createReceipt(allocation, store.config, {
      receipt_type: input.receipt_type,
      sequence,
      prior_receipt_id: prior.receipt_id,
      candidate,
      payload,
      created_at: createdAt
    });
    validateReceiptChain([...chain, receipt]);
    const existing = db.prepare('SELECT canonical_json FROM receipts WHERE run_id = ? AND sequence = ?').get(state.runId, sequence);
    if (existing) {
      if (existing.canonical_json === canonicalSerialize(receipt)) return deepFreeze({ receipt, duplicate: true });
      fail('GPR_SEQUENCE_CONFLICT');
    }
    transaction(db, () => {
      verifyFenceDb(db, state, isoAt());
      const liveChain = readChainDb(db, state.runId);
      if (liveChain.length !== chain.length || liveChain[liveChain.length - 1].receipt_id !== prior.receipt_id) fail('GPR_CHAIN_CONFLICT');
      db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        receipt.receipt_id, receipt.run_id, receipt.sequence, receipt.receipt_type,
        receipt.prior_receipt_id, canonicalSerialize(receipt), receipt.receipt_id
      );
      if (TERMINAL_TYPES.includes(receipt.receipt_type)) {
        insertLeaseEvent(db, allocation, 'RELEASED', createdAt, { receipt_id: receipt.receipt_id, receipt_type: receipt.receipt_type });
      }
    });
  } finally {
    db.close();
  }
  const readback = store.readReceiptChain(state.runId);
  const receipt = readback[readback.length - 1];
  if (receipt.sequence < 2 || receipt.created_at !== createdAt || receipt.receipt_type !== input.receipt_type) fail('GPR_READBACK_MISMATCH');
  return deepFreeze({ receipt, duplicate: false });
}

function verifyAuthoritySnapshot(expected, snapshot) {
  if (!isRecord(snapshot) || !isRecord(snapshot.authority) || !Array.isArray(snapshot.later_controlling_comments)) fail('GPR_AUTHORITY_UNVERIFIED');
  const observed = validateAuthority(snapshot.authority);
  if (canonicalSerialize(observed) !== canonicalSerialize(expected) || snapshot.later_controlling_comments.length > 0) fail('GPR_AUTHORITY_CHANGED');
  return observed;
}

async function callReader(reader, errorCode) {
  if (typeof reader !== 'function') fail(errorCode);
  try {
    return await reader();
  } catch (error) {
    if (error instanceof GprError) throw error;
    fail(errorCode, { cause: error && error.code ? error.code : 'reader-failed' });
  }
}

function createProgrammeReceiptStore(options) {
  const namespace = namespaceValue(options || {});
  const stateRoot = assertSafeStateRoot(options || {});
  const config = Object.freeze({
    namespace,
    namespaceDigest: namespaceDigest(namespace),
    stateRoot,
    repositoryRoot: path.resolve(options.repositoryRoot),
    databasePath: path.join(stateRoot, `github-program-receipt-${namespaceDigest(namespace)}.sqlite`)
  });
  const store = {
    instanceId: randomId('store'),
    config,
    get databasePath() { return config.databasePath; },
    allocateRun(input) {
      if (isRecord(input) && ('lease' in input || 'fence_id' in input || 'fence_sequence' in input || 'lease_id' in input)) fail('GPR_CALLER_FENCE_FORBIDDEN');
      if (!exactKeys(input, ['lock', 'authority', 'start', 'candidate', 'lease_ms'])
        || !isSafeId(input.lock) || !Number.isSafeInteger(input.lease_ms)
        || input.lease_ms < LIMITS.leaseMinMs || input.lease_ms > LIMITS.leaseMaxMs) fail('GPR_ALLOCATION_INVALID');
      const authority = validateAuthority(input.authority);
      const start = validateStart(input.start);
      if (input.candidate !== undefined && input.candidate !== null) fail('GPR_FAKE_START_CANDIDATE');
      const ownerInstanceId = randomId('owner');
      const db = openVerified(config);
      let allocation;
      try {
        allocation = transaction(db, () => {
          const issuedAt = isoAt();
          const expiresAt = isoAt(Date.parse(issuedAt) + input.lease_ms);
          if (db.prepare('SELECT COUNT(*) AS value FROM allocations').get().value >= LIMITS.allocationsPerNamespace) fail('GPR_ALLOCATION_LIMIT');
          const active = activeAllocationDb(db, issuedAt);
          if (active) fail('GPR_ACTIVE_LEASE', { run_id: active.run_id, lock: active.lock_id, expires_at: active.expires_at });
          const previous = latestAllocationDb(db);
          const highWater = db.prepare('SELECT high_water FROM coordination_state WHERE singleton = 1').get().high_water;
          const fenceSequence = highWater + 1;
          const row = {
            allocation_id: randomId('allocation'),
            run_id: randomId('run'),
            lock_id: input.lock,
            lease_id: randomId('lease'),
            fence_id: randomId('fence'),
            fence_sequence: fenceSequence,
            owner_instance_id: ownerInstanceId,
            process_id: process.pid,
            issued_at: issuedAt,
            expires_at: expiresAt,
            authority_json: canonicalSerialize(authority),
            start_json: canonicalSerialize(start)
          };
          row.allocation_digest = digestValue({
            allocation_id: row.allocation_id,
            run_id: row.run_id,
            lock: row.lock_id,
            lease_id: row.lease_id,
            fence_id: row.fence_id,
            fence_sequence: row.fence_sequence,
            owner_instance_id: row.owner_instance_id,
            process_id: row.process_id,
            issued_at: row.issued_at,
            expires_at: row.expires_at,
            authority,
            start
          });
          db.prepare('UPDATE coordination_state SET high_water = ? WHERE singleton = 1 AND high_water = ?').run(fenceSequence, highWater);
          db.prepare('INSERT INTO allocations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            row.allocation_id, row.run_id, row.lock_id, row.lease_id, row.fence_id,
            row.fence_sequence, row.owner_instance_id, row.process_id, row.issued_at,
            row.expires_at, row.authority_json, row.start_json, row.allocation_digest
          );
          const run = {
            run_id: row.run_id,
            allocation_id: row.allocation_id,
            lock: row.lock_id,
            authority_digest: digestValue(authority),
            start_digest: digestValue(start)
          };
          run.run_digest = digestValue(run);
          db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?)').run(
            run.run_id, run.allocation_id, run.lock, run.authority_digest, run.start_digest, run.run_digest
          );
          insertLeaseEvent(db, row, previous ? 'EXPIRED_TAKEOVER' : 'ALLOCATED', issuedAt, {
            prior_allocation_id: previous ? previous.allocation_id : null,
            prior_fence_sequence: previous ? previous.fence_sequence : null
          });
          return row;
        });
      } finally {
        db.close();
      }
      const session = deepFreeze({ ...allocationPublic(allocation), started: false });
      SESSION_OWNERS.set(session, {
        storeInstanceId: store.instanceId,
        ownerInstanceId,
        processId: process.pid,
        allocationId: allocation.allocation_id,
        runId: allocation.run_id
      });
      return session;
    },
    async startAllocatedRun(session, readers) {
      const state = sessionState(store, session);
      const db = openVerified(config);
      let allocation;
      try {
        allocation = verifyFenceDb(db, state, isoAt());
        if (readChainDb(db, state.runId, true).length > 0) fail('GPR_RUN_ALREADY_STARTED');
      } finally {
        db.close();
      }
      const authority = JSON.parse(allocation.authority_json);
      const start = JSON.parse(allocation.start_json);
      verifyAuthoritySnapshot(authority, await callReader(readers && readers.readAuthority, 'GPR_AUTHORITY_UNVERIFIED'));
      const observedStart = validateStart(await callReader(readers && readers.readStart, 'GPR_START_UNVERIFIED'));
      if (canonicalSerialize(observedStart) !== canonicalSerialize(start)) fail('GPR_START_CHANGED');
      let receipt;
      const writeDb = openVerified(config);
      try {
        transaction(writeDb, () => {
          const transactionNow = isoAt();
          verifyFenceDb(writeDb, state, transactionNow);
          if (readChainDb(writeDb, state.runId, true).length > 0) fail('GPR_RUN_ALREADY_STARTED');
          receipt = createReceipt(allocation, config, {
            receipt_type: 'RUN_STARTED',
            sequence: 1,
            prior_receipt_id: null,
            candidate: null,
            payload: { classification: 'RUN_STARTED_VERIFIED' },
            created_at: transactionNow
          });
          writeDb.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            receipt.receipt_id, receipt.run_id, receipt.sequence, receipt.receipt_type,
            receipt.prior_receipt_id, canonicalSerialize(receipt), receipt.receipt_id
          );
        });
      } finally {
        writeDb.close();
      }
      const readback = store.readReceiptChain(state.runId);
      if (readback.length !== 1 || readback[0].receipt_id !== receipt.receipt_id) fail('GPR_READBACK_MISMATCH');
      const started = deepFreeze({ ...allocationPublic(allocation), started: true, run_started_receipt_id: receipt.receipt_id });
      SESSION_OWNERS.set(started, state);
      return started;
    },
    async startRun(input, readers) {
      const allocated = store.allocateRun(input);
      return store.startAllocatedRun(allocated, readers);
    },
    appendReceipt(session, input) {
      return appendReceiptInternal(store, session, input);
    },
    interruptRun(session, input = {}) {
      return appendReceiptInternal(store, session, {
        receipt_type: 'RUN_INTERRUPTED',
        candidate: input.candidate,
        payload: input.payload || { classification: 'RUN_INTERRUPTED' },
        created_at: input.created_at
      });
    },
    readReceiptChain(runId) {
      if (!isSafeId(runId)) fail('GPR_RUN_ID_INVALID');
      const db = openVerified(config, false);
      try { return readChainDb(db, runId); } finally { db.close(); }
    },
    classifyRecovery(runId, now = Date.now()) {
      if (!isSafeId(runId)) fail('GPR_RUN_ID_INVALID');
      const observedAt = isoAt(now);
      const db = openVerified(config, false);
      try {
        const allocation = db.prepare('SELECT * FROM allocations WHERE run_id = ?').get(runId);
        if (!allocation) return deepFreeze({ status: 'RUN_NOT_FOUND', run_id: runId });
        const chain = readChainDb(db, runId, true);
        if (chain.length && TERMINAL_TYPES.includes(chain[chain.length - 1].receipt_type)) return deepFreeze({ status: 'TERMINAL', run_id: runId, receipt_id: chain[chain.length - 1].receipt_id });
        const expired = Date.parse(allocation.expires_at) <= Date.parse(observedAt);
        if (!chain.length) return deepFreeze({ status: expired ? 'UNSTARTED_ALLOCATION_EXPIRED' : 'UNSTARTED_ALLOCATION_ACTIVE', run_id: runId });
        return deepFreeze({ status: expired ? 'STARTED_LEASE_EXPIRED' : 'LIVE_RUN_NOT_ADOPTABLE', run_id: runId });
      } finally {
        db.close();
      }
    },
    async performMutation(session, operation) {
      const state = sessionState(store, session);
      if (!isRecord(operation) || typeof operation.readAuthority !== 'function'
        || typeof operation.readSource !== 'function' || typeof operation.mutate !== 'function'
        || !isDigest(operation.expected_source_digest)) fail('GPR_MUTATION_OPERATION_INVALID');
      let allocation;
      let chain;
      const firstDb = openVerified(config, false);
      try {
        allocation = verifyFenceDb(firstDb, state, isoAt());
        chain = readChainDb(firstDb, state.runId);
        if (chain[0].receipt_type !== 'RUN_STARTED' || chain[0].sequence !== 1) fail('GPR_RUN_NOT_STARTED');
        if (TERMINAL_TYPES.includes(chain[chain.length - 1].receipt_type)) fail('GPR_RUN_TERMINAL');
      } finally {
        firstDb.close();
      }
      verifyAuthoritySnapshot(JSON.parse(allocation.authority_json), await callReader(operation.readAuthority, 'GPR_AUTHORITY_UNVERIFIED'));
      const source = await callReader(operation.readSource, 'GPR_SOURCE_UNVERIFIED');
      assertPrivacySafe(source);
      if (digestValue(source) !== operation.expected_source_digest) fail('GPR_SOURCE_CHANGED');
      const finalDb = openVerified(config, false);
      try {
        verifyFenceDb(finalDb, state, isoAt());
        const latest = readChainDb(finalDb, state.runId);
        if (latest[0].receipt_id !== chain[0].receipt_id || TERMINAL_TYPES.includes(latest[latest.length - 1].receipt_type)) fail('GPR_RUN_TERMINAL');
      } finally {
        finalDb.close();
      }
      try {
        return await operation.mutate();
      } catch (error) {
        try {
          appendReceiptInternal(store, session, {
            receipt_type: 'RUN_INTERRUPTED',
            payload: { classification: 'MUTATION_OUTCOME_UNKNOWN', operation_digest: digestValue({ expected_source_digest: operation.expected_source_digest }) },
            created_at: isoAt()
          });
        } catch (_) { /* The unknown mutation result remains the primary fail-closed outcome. */ }
        fail('GPR_MUTATION_OUTCOME_UNKNOWN', { cause: error && error.code ? error.code : 'adapter-failed' });
      }
    },
    verifyFreshReadback(runId) {
      const first = store.readReceiptChain(runId);
      const second = createProgrammeReceiptStore({ ...config.namespace, stateRoot: config.stateRoot, repositoryRoot: config.repositoryRoot }).readReceiptChain(runId);
      if (canonicalSerialize(first) !== canonicalSerialize(second)) fail('GPR_READBACK_MISMATCH');
      return second;
    }
  };
  openVerified(config).close();
  return Object.freeze(store);
}

function parseArgs(args) {
  const result = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) result._.push(value);
    else {
      const key = value.slice(2).replace(/-/g, '_');
      result[key] = args[index + 1];
      index += 1;
    }
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._[0] === 'runtime-check') {
    assertRuntimeSupport();
    process.stdout.write(`${JSON.stringify({ ok: true, schema: SCHEMA_ID, node: process.versions.node })}\n`);
    return;
  }
  if (args._[0] === 'inspect') {
    const store = createProgrammeReceiptStore({
      repository: args.repository,
      parent_issue: Number(args.parent_issue),
      child_issue: Number(args.child_issue),
      stateRoot: args.state_root,
      repositoryRoot: args.repository_root
    });
    const chain = store.readReceiptChain(args.run_id);
    process.stdout.write(`${JSON.stringify({ ok: true, chain })}\n`);
    return;
  }
  fail('GPR_COMMAND_INVALID');
}

if (require.main === module) {
  try { main(); } catch (error) {
    const code = error instanceof GprError ? error.code : 'GPR_INTERNAL_ERROR';
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  APPLICATION_ID,
  BUSY_TIMEOUT_MS,
  LIMITS,
  MIN_NODE_VERSION,
  RECEIPT_TYPES,
  SCHEMA_ID,
  TERMINAL_TYPES,
  USER_VERSION,
  GprError,
  assertRuntimeSupport,
  createProgrammeReceiptStore,
  digestValue,
  canonicalSerialize,
  namespaceDigest,
  resolveDatabasePath,
  validateAuthority,
  validateCandidate,
  validateReceiptChain,
  validateReceiptObject,
  validateStart,
  validateWindowsStorageProof
});
