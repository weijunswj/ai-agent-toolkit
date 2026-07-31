#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const defaultReviewStatePath = 'repo/source-watch/review-state.json';
const fullCommitShaPattern = /^[0-9a-f]{40}$/i;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const allowedDispositions = new Set([
  'NO_ACTION',
  'TRACKER_UPDATE',
  'READ_ONLY_REVIEW_REQUIRED',
  'SEPARATE_IMPLEMENTATION_PR_RECOMMENDED',
  'UNVERIFIED'
]);
const allowedTargetKinds = new Set(['source_lock', 'advisory']);
const allowedDocumentFields = new Set(['schema_version', 'policy', 'records']);
const allowedPolicyFields = new Set([
  'cursor_advancement',
  'runtime_updates',
  'adoption_and_review_are_distinct',
  'description'
]);
const commonRecordFields = new Set([
  'target_key',
  'target_kind',
  'repository',
  'ref',
  'reviewed_through_sha',
  'reviewed_at',
  'disposition',
  'owning_tracker'
]);

function resolveWorkspacePath(workspace, relOrAbsPath) {
  return path.isAbsolute(relOrAbsPath) ? relOrAbsPath : path.resolve(workspace, relOrAbsPath);
}

function emptyReviewStateDocument() {
  return {
    schema_version: 1,
    policy: {
      cursor_advancement: 'human_advanced_only',
      runtime_updates: 'forbidden',
      adoption_and_review_are_distinct: true
    },
    records: []
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function validateIsoDate(value, label) {
  if (typeof value !== 'string' || !isoDatePattern.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid calendar date`);
  }
  return value;
}

function projectPathFromSourceLockPath(sourceLockPath) {
  if (!sourceLockPath.endsWith('/SOURCE-LOCK.json')) {
    throw new Error(`source_lock_path must end with /SOURCE-LOCK.json: ${sourceLockPath}`);
  }
  return sourceLockPath.slice(0, -'/SOURCE-LOCK.json'.length);
}

function expectedTargetKey(record) {
  if (record.target_kind === 'source_lock') {
    return `source-lock:${projectPathFromSourceLockPath(record.source_lock_path)}`;
  }
  return `advisory:${record.advisory_target_id}`;
}

function validateRecord(rawRecord, index) {
  if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
    throw new Error(`records[${index}] must be an object`);
  }
  const targetKey = requireString(rawRecord.target_key, `records[${index}].target_key`);
  const targetKind = requireString(rawRecord.target_kind, `${targetKey} target_kind`);
  if (!allowedTargetKinds.has(targetKind)) {
    throw new Error(`${targetKey} target_kind must be source_lock or advisory`);
  }

  const allowedFields = new Set(commonRecordFields);
  if (targetKind === 'source_lock') allowedFields.add('source_lock_path');
  else {
    allowedFields.add('advisory_target_id');
    allowedFields.add('path');
  }
  for (const field of Object.keys(rawRecord)) {
    if (!allowedFields.has(field)) throw new Error(`${targetKey} contains unsupported field ${field}`);
  }

  const record = {
    ...rawRecord,
    target_key: targetKey,
    target_kind: targetKind,
    repository: requireString(rawRecord.repository, `${targetKey} repository`),
    ref: requireString(rawRecord.ref, `${targetKey} ref`),
    reviewed_through_sha: requireString(rawRecord.reviewed_through_sha, `${targetKey} reviewed_through_sha`),
    reviewed_at: validateIsoDate(rawRecord.reviewed_at, `${targetKey} reviewed_at`),
    disposition: requireString(rawRecord.disposition, `${targetKey} disposition`),
    owning_tracker: requireString(rawRecord.owning_tracker, `${targetKey} owning_tracker`)
  };
  if (!fullCommitShaPattern.test(record.reviewed_through_sha)) {
    throw new Error(`${targetKey} reviewed_through_sha must be a 40-character SHA`);
  }
  if (!allowedDispositions.has(record.disposition)) {
    throw new Error(`${targetKey} disposition is unsupported: ${record.disposition}`);
  }
  if (!/^#[0-9]+$/.test(record.owning_tracker)) {
    throw new Error(`${targetKey} owning_tracker must be a GitHub issue reference such as #315`);
  }

  if (targetKind === 'source_lock') {
    record.source_lock_path = requireString(rawRecord.source_lock_path, `${targetKey} source_lock_path`);
    if ('advisory_target_id' in rawRecord || 'path' in rawRecord) {
      throw new Error(`${targetKey} source_lock records cannot contain advisory identity fields`);
    }
  } else {
    record.advisory_target_id = requireString(rawRecord.advisory_target_id, `${targetKey} advisory_target_id`);
    if ('source_lock_path' in rawRecord) {
      throw new Error(`${targetKey} advisory records cannot contain source-lock identity fields`);
    }
    if ('path' in rawRecord) record.path = requireString(rawRecord.path, `${targetKey} path`);
  }
  if (expectedTargetKey(record) !== record.target_key) {
    throw new Error(`${record.target_key} does not match its bound target identity`);
  }
  return record;
}

function matchesTargetIdentity(record, identity) {
  if (!record || !identity) return false;
  const fields = ['target_key', 'target_kind', 'repository', 'ref'];
  if (fields.some((field) => record[field] !== identity[field])) return false;
  if (identity.target_kind === 'source_lock') return record.source_lock_path === identity.source_lock_path;
  if (record.advisory_target_id !== identity.advisory_target_id) return false;
  return (record.path || '') === (identity.path || '');
}

function validateReviewStateDocument(document, relPath = defaultReviewStatePath, identities = null) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`${relPath} must be a JSON object`);
  }
  for (const field of Object.keys(document)) {
    if (!allowedDocumentFields.has(field)) throw new Error(`${relPath} contains unsupported top-level field ${field}`);
  }
  if (document.schema_version !== 1) throw new Error(`${relPath} schema_version must be 1`);
  if (!document.policy || typeof document.policy !== 'object' || Array.isArray(document.policy)) {
    throw new Error(`${relPath} policy must be an object`);
  }
  for (const field of Object.keys(document.policy)) {
    if (!allowedPolicyFields.has(field)) throw new Error(`${relPath} policy contains unsupported field ${field}`);
  }
  if (document.policy.cursor_advancement !== 'human_advanced_only') {
    throw new Error(`${relPath} policy must state cursor_advancement human_advanced_only`);
  }
  if (document.policy.runtime_updates !== 'forbidden') {
    throw new Error(`${relPath} policy must state runtime_updates forbidden`);
  }
  if (document.policy.adoption_and_review_are_distinct !== true) {
    throw new Error(`${relPath} policy must distinguish adoption and review`);
  }
  if ('description' in document.policy) {
    requireString(document.policy.description, `${relPath} policy.description`);
  }
  if (!Array.isArray(document.records)) throw new Error(`${relPath} records must be an array`);

  const records = document.records.map(validateRecord);
  const seenKeys = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (seenKeys.has(record.target_key)) throw new Error(`${relPath} has duplicate target key ${record.target_key}`);
    seenKeys.add(record.target_key);
    if (index > 0 && records[index - 1].target_key.localeCompare(record.target_key) > 0) {
      throw new Error(`${relPath} records must be ordered by target_key`);
    }
  }

  if (identities) {
    const identitiesByKey = new Map();
    for (const identity of identities) {
      if (!identity || typeof identity !== 'object') throw new Error(`${relPath} contains an invalid target identity`);
      if (identitiesByKey.has(identity.target_key)) throw new Error(`${relPath} has ambiguous target identity ${identity.target_key}`);
      identitiesByKey.set(identity.target_key, identity);
    }
    for (const record of records) {
      const identity = identitiesByKey.get(record.target_key);
      if (!identity || !matchesTargetIdentity(record, identity)) {
        throw new Error(`${relPath} identity mismatch for ${record.target_key}`);
      }
    }
  }
  return records;
}

function readReviewState(workspace, reviewStatePath = defaultReviewStatePath) {
  const fullPath = resolveWorkspacePath(workspace, reviewStatePath);
  if (!fs.existsSync(fullPath)) {
    return { relPath: reviewStatePath, fullPath, document: emptyReviewStateDocument(), records: [] };
  }
  const document = readJson(fullPath);
  const records = validateReviewStateDocument(document, reviewStatePath);
  return { relPath: reviewStatePath, fullPath, document, records };
}

function sourceLockIdentity({ relPath, lock }) {
  const sourceLockPath = relPath.replace(/\\/g, '/');
  const projectPath = projectPathFromSourceLockPath(sourceLockPath);
  return {
    target_key: `source-lock:${projectPath}`,
    target_kind: 'source_lock',
    repository: requireString(lock.source_repo, `${sourceLockPath} source_repo`),
    ref: requireString(lock.source_ref, `${sourceLockPath} source_ref`),
    source_lock_path: sourceLockPath
  };
}

function advisoryIdentity(target) {
  const kind = requireString(target.kind, `${target.id} kind`);
  if (!['github_repo', 'github_path'].includes(kind)) throw new Error(`${target.id} is not a GitHub advisory target`);
  const identity = {
    target_key: `advisory:${requireString(target.id, 'advisory id')}`,
    target_kind: 'advisory',
    repository: requireString(target.repo, `${target.id} repo`),
    ref: requireString(target.ref, `${target.id} ref`),
    advisory_target_id: target.id
  };
  if (kind === 'github_path') identity.path = requireString(target.path, `${target.id} path`);
  return identity;
}

function findMatchingReviewRecord(reviewState, identity) {
  const record = (reviewState.records || []).find((candidate) => candidate.target_key === identity.target_key);
  return matchesTargetIdentity(record, identity) ? record : null;
}

module.exports = {
  allowedDispositions,
  defaultReviewStatePath,
  emptyReviewStateDocument,
  findMatchingReviewRecord,
  matchesTargetIdentity,
  readReviewState,
  sourceLockIdentity,
  advisoryIdentity,
  validateIsoDate,
  validateRecord,
  validateReviewStateDocument
};
