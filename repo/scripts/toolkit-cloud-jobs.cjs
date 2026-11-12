'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONTRACT_PATH = Object.freeze(['repo', 'contracts', 'cloud-jobs.json']);
const CONTRACT_SCHEMA = 'toolkit.cloud-jobs.v1';
const SECRET_NAME = 'TOOLKIT_GOVERNANCE_TOKEN';
const NEVER_GRANTED = Object.freeze(['administration', 'secrets', 'workflows', 'account']);
const REPOSITORY_ROLES = Object.freeze(['governed_repository', 'evidence_store']);
const PERMISSION_NAMES = Object.freeze(['actions', 'contents', 'issues', 'metadata', 'pull_requests']);
const ACCESS_LEVELS = Object.freeze(['read', 'write']);
const MAX_CONTRACT_BYTES = 128 * 1024;
const SAFE_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CRON = /^[0-9*/,-]+(?: [0-9*/,-]+){4}$/;

class CloudJobsContractError extends Error {}

function fail(reason) {
  throw new CloudJobsContractError(`Cloud jobs contract is invalid: ${reason}.`);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validText(value, pattern, maxLength = 180) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && pattern.test(value);
}

function validatePermissions(value, jobId, role) {
  if (!isRecord(value)) fail(`job ${jobId} ${role} permissions are missing`);
  for (const [permission, access] of Object.entries(value)) {
    if (!PERMISSION_NAMES.includes(permission)) fail(`job ${jobId} has an unapproved ${role} permission`);
    if (!Array.isArray(access) || access.length < 1 || access.length > ACCESS_LEVELS.length
        || access.some(level => !ACCESS_LEVELS.includes(level)) || new Set(access).size !== access.length) {
      fail(`job ${jobId} ${role} permission access is invalid`);
    }
    if (access.includes('write') && !access.includes('read')) fail(`job ${jobId} write permission must list read access`);
  }
}

function validateCloudJobsContract(contract) {
  if (!hasExactKeys(contract, ['schema', 'secret_name', 'never_granted', 'jobs'])) fail('top-level fields');
  if (contract.schema !== CONTRACT_SCHEMA) fail('schema');
  if (contract.secret_name !== SECRET_NAME) fail('shared secret name');
  if (!Array.isArray(contract.never_granted) || contract.never_granted.length !== NEVER_GRANTED.length
      || contract.never_granted.some((value, index) => value !== NEVER_GRANTED[index])) fail('never-granted permissions');
  if (!Array.isArray(contract.jobs) || contract.jobs.length < 1 || contract.jobs.length > 64) fail('job rows');

  const ids = new Set();
  for (const job of contract.jobs) {
    if (!hasExactKeys(job, ['id', 'workflow', 'schedule', 'replaces_laptop_job', 'permissions'])) fail('job row fields');
    if (!validText(job.id, /^[a-z][a-z0-9-]{0,63}$/) || ids.has(job.id)) fail('duplicate or invalid job id');
    ids.add(job.id);
    if (!validText(job.workflow, /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/)) fail(`job ${job.id} workflow path`);
    if (!hasExactKeys(job.schedule, ['cadence', 'cron']) || !validText(job.schedule.cadence, /^[a-z][a-z0-9-]{0,31}$/)
        || !validText(job.schedule.cron, CRON, 64)) fail(`job ${job.id} schedule`);
    if (!validText(job.replaces_laptop_job, /^[A-Za-z0-9_-]{1,100}$/)) fail(`job ${job.id} replacement`);
    if (!hasExactKeys(job.permissions, REPOSITORY_ROLES)) fail(`job ${job.id} permission roles`);
    for (const role of REPOSITORY_ROLES) validatePermissions(job.permissions[role], job.id, role);
  }
  return contract.jobs;
}

function readCloudJobsContract({ root = process.cwd(), readFile = fs.readFileSync } = {}) {
  const file = path.join(root, ...CONTRACT_PATH);
  let bytes;
  try {
    bytes = readFile(file);
  } catch {
    throw new CloudJobsContractError('Cloud jobs contract could not be read.');
  }
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  if (buffer.length > MAX_CONTRACT_BYTES) fail('file size');
  let contract;
  try {
    contract = JSON.parse(buffer.toString('utf8'));
  } catch {
    fail('JSON');
  }
  validateCloudJobsContract(contract);
  return contract;
}

function unionPermissions(jobs, role) {
  const union = new Map();
  for (const job of jobs) {
    for (const [permission, access] of Object.entries(job.permissions[role])) {
      const levels = union.get(permission) || new Set();
      for (const level of access) levels.add(level);
      union.set(permission, levels);
    }
  }
  return Object.fromEntries(PERMISSION_NAMES
    .filter(permission => union.has(permission))
    .map(permission => [permission, ACCESS_LEVELS.filter(level => union.get(permission).has(level))]));
}

function buildCloudJobsGuide({ root = process.cwd(), contract = null } = {}) {
  const source = contract || readCloudJobsContract({ root });
  const jobs = validateCloudJobsContract(source);
  return {
    secret_name: source.secret_name,
    jobs: jobs.map(job => structuredClone(job)),
    combined_permissions: Object.fromEntries(REPOSITORY_ROLES.map(role => [role, unionPermissions(jobs, role)])),
    never_granted: [...source.never_granted],
  };
}

function validRepositorySlug(repository) {
  return typeof repository === 'string' && repository.length <= 180 && SAFE_SLUG.test(repository)
    && !repository.split('/').some(part => part === '.' || part === '..');
}

function hasOnlyMetadataFields(value) {
  const allowed = new Set(['status', 'name', 'created_at', 'updated_at', 'exists']);
  return Object.keys(value).every(key => allowed.has(key));
}

async function checkSecretMetadata({ root = process.cwd(), contract = null, repository, readSecretMetadata } = {}) {
  const source = contract || readCloudJobsContract({ root });
  validateCloudJobsContract(source);
  const secretName = source.secret_name;
  const unavailable = { status: 'unavailable', secret_name: secretName };
  if (!validRepositorySlug(repository) || typeof readSecretMetadata !== 'function') return unavailable;

  let metadata;
  try {
    metadata = await readSecretMetadata({ repository, secret_name: secretName });
  } catch {
    return unavailable;
  }
  if (!isRecord(metadata) || !hasOnlyMetadataFields(metadata)) return unavailable;
  if (metadata.status === 404 || metadata.exists === false) return { status: 'missing', secret_name: secretName };
  if ((metadata.status === 200 || metadata.exists === true) && metadata.name === secretName) {
    return { status: 'present', secret_name: secretName };
  }
  return unavailable;
}

function createCloudJobsGuide({ root = process.cwd(), readSecretMetadata = null } = {}) {
  return Object.freeze({
    list: () => buildCloudJobsGuide({ root }),
    checkSecretMetadata: repository => checkSecretMetadata({ root, repository, readSecretMetadata }),
  });
}

module.exports = Object.freeze({
  CONTRACT_PATH: CONTRACT_PATH.join('/'),
  CONTRACT_SCHEMA,
  SECRET_NAME,
  NEVER_GRANTED,
  CloudJobsContractError,
  validateCloudJobsContract,
  readCloudJobsContract,
  buildCloudJobsGuide,
  checkSecretMetadata,
  createCloudJobsGuide,
});
