'use strict';

// The scheduled jobs that run on GitHub instead of on a computer, and the one governance GitHub App
// they share. Each job row names its workflow, its schedule, the laptop job it replaces and the
// installation tokens it mints, one per repository, each with exactly its permissions. The App's
// permissions are set once to the union of every row; each workflow narrows its own tokens.
// Reading the contract is offline. The setup check asks GitHub only whether the App's variable and
// secret exist (metadata, never a value); whether the App is installed is proved by the first run.
const fs = require('node:fs');
const path = require('node:path');

const CONTRACT_PATH = Object.freeze(['repo', 'contracts', 'cloud-jobs.json']);
const CONTRACT_SCHEMA = 'toolkit.cloud-jobs.v1';
const APP = Object.freeze({ client_id_variable: 'TOOLKIT_GOVERNANCE_APP_CLIENT_ID', private_key_secret: 'TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY' });
const NEVER_GRANTED = Object.freeze(['administration', 'secrets', 'workflows', 'account']);
const REPOSITORY_ROLES = Object.freeze(['governed_repository', 'evidence_store']);
// GitHub App repository permissions a row may name, with the names GitHub's App settings show.
const PERMISSIONS = Object.freeze({ contents: 'Contents', issues: 'Issues', pull_requests: 'Pull requests', checks: 'Checks', statuses: 'Commit statuses' });
const LEVELS = Object.freeze(['read', 'write']);
const MAX_CONTRACT_BYTES = 128 * 1024;
const SAFE_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CRON = /^[0-9*/,-]+(?: [0-9*/,-]+){4}$/;

class CloudJobsContractError extends Error {}

function fail(reason) { throw new CloudJobsContractError(`Cloud jobs contract is invalid: ${reason}.`); }
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasExactKeys = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validText = (value, pattern, maxLength = 180) => typeof value === 'string' && value.length > 0 && value.length <= maxLength && pattern.test(value);

function validateToken(token, jobId, names) {
  if (!hasExactKeys(token, ['name', 'repository', 'permissions'])) fail(`job ${jobId} token fields`);
  if (!validText(token.name, /^[a-z][a-z0-9-]{0,31}$/) || names.has(token.name)) fail(`job ${jobId} duplicate or invalid token name`);
  names.add(token.name);
  if (!REPOSITORY_ROLES.includes(token.repository)) fail(`job ${jobId} token ${token.name} repository`);
  if (!isRecord(token.permissions) || !Object.keys(token.permissions).length) fail(`job ${jobId} token ${token.name} permissions`);
  for (const [permission, level] of Object.entries(token.permissions)) {
    if (NEVER_GRANTED.includes(permission) || !Object.hasOwn(PERMISSIONS, permission)) fail(`job ${jobId} token ${token.name} asks for an unapproved permission`);
    if (!LEVELS.includes(level)) fail(`job ${jobId} token ${token.name} permission level`);
  }
}

function validateCloudJobsContract(contract) {
  if (!hasExactKeys(contract, ['schema', 'app', 'never_granted', 'jobs'])) fail('top-level fields');
  if (contract.schema !== CONTRACT_SCHEMA) fail('schema');
  if (!hasExactKeys(contract.app, ['client_id_variable', 'private_key_secret'])
    || contract.app.client_id_variable !== APP.client_id_variable || contract.app.private_key_secret !== APP.private_key_secret) fail('governance App variable and secret names');
  if (!Array.isArray(contract.never_granted) || contract.never_granted.length !== NEVER_GRANTED.length
    || contract.never_granted.some((value, index) => value !== NEVER_GRANTED[index])) fail('never-granted permissions');
  if (!Array.isArray(contract.jobs) || contract.jobs.length < 1 || contract.jobs.length > 64) fail('job rows');
  const ids = new Set();
  for (const job of contract.jobs) {
    if (!hasExactKeys(job, ['id', 'workflow', 'schedule', 'replaces_laptop_job', 'tokens'])) fail('job row fields');
    if (!validText(job.id, /^[a-z][a-z0-9-]{0,63}$/) || ids.has(job.id)) fail('duplicate or invalid job id');
    ids.add(job.id);
    if (!validText(job.workflow, /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/)) fail(`job ${job.id} workflow path`);
    if (!hasExactKeys(job.schedule, ['cadence', 'cron']) || !validText(job.schedule.cadence, /^[a-z][a-z0-9-]{0,31}$/)
      || !validText(job.schedule.cron, CRON, 64)) fail(`job ${job.id} schedule`);
    if (!validText(job.replaces_laptop_job, /^[A-Za-z0-9_-]{1,100}$/)) fail(`job ${job.id} replacement`);
    if (!Array.isArray(job.tokens) || job.tokens.length < 1 || job.tokens.length > REPOSITORY_ROLES.length) fail(`job ${job.id} tokens`);
    const names = new Set();
    for (const token of job.tokens) validateToken(token, job.id, names);
    if (new Set(job.tokens.map(token => token.repository)).size !== job.tokens.length) fail(`job ${job.id} has two tokens for one repository`);
  }
  return contract.jobs;
}

function readCloudJobsContract({ root = process.cwd(), readFile = fs.readFileSync } = {}) {
  let bytes;
  try { bytes = readFile(path.join(root, ...CONTRACT_PATH)); }
  catch { throw new CloudJobsContractError('Cloud jobs contract could not be read.'); }
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  if (buffer.length > MAX_CONTRACT_BYTES) fail('file size');
  let contract;
  try { contract = JSON.parse(buffer.toString('utf8')); } catch { fail('JSON'); }
  validateCloudJobsContract(contract);
  return contract;
}

// The App's one-time permission set: for each repository, the highest level any row asks for.
function unionPermissions(jobs) {
  const union = Object.fromEntries(REPOSITORY_ROLES.map(role => [role, {}]));
  for (const job of jobs) for (const token of job.tokens) {
    for (const [permission, level] of Object.entries(token.permissions)) {
      const current = union[token.repository][permission];
      union[token.repository][permission] = current === 'write' || level === 'write' ? 'write' : 'read';
    }
  }
  for (const role of REPOSITORY_ROLES) {
    union[role] = Object.fromEntries(Object.keys(PERMISSIONS).filter(name => union[role][name]).map(name => [name, union[role][name]]));
  }
  return union;
}

// How a permission reads in GitHub's App settings: "Issues: read and write".
const permissionText = (name, level) => `${PERMISSIONS[name]}: ${level === 'write' ? 'read and write' : 'read'}`;

function buildCloudJobsGuide({ root = process.cwd(), contract = null } = {}) {
  const source = contract || readCloudJobsContract({ root });
  const jobs = validateCloudJobsContract(source);
  return { app: { ...source.app }, jobs: jobs.map(job => structuredClone(job)), app_permissions: unionPermissions(jobs), never_granted: [...source.never_granted] };
}

// The guide as lines for `toolkit governance check`.
function guideLines(guide, setup = null) {
  const roles = { governed_repository: 'Governed repository', evidence_store: 'Evidence store' };
  const lines = [`Cloud jobs: one governance GitHub App, variable ${guide.app.client_id_variable} and secret ${guide.app.private_key_secret}`];
  for (const job of guide.jobs) {
    lines.push(`- ${job.id}: ${job.schedule.cadence} (${job.workflow}), replaces the computer's ${job.replaces_laptop_job}`);
    for (const token of job.tokens) lines.push(`  ${roles[token.repository]} token: ${Object.entries(token.permissions).map(([name, level]) => permissionText(name, level)).join(', ')}`);
  }
  lines.push('App permissions to set once (each workflow narrows its own token):');
  for (const role of REPOSITORY_ROLES) {
    const permissions = Object.entries(guide.app_permissions[role]);
    if (permissions.length) lines.push(`- ${roles[role]}: ${permissions.map(([name, level]) => permissionText(name, level)).join(', ')}`);
  }
  lines.push(`Never grant: ${guide.never_granted.join(', ')}.`);
  if (setup) {
    lines.push(`App variable ${guide.app.client_id_variable}: ${setup.variable}. App secret ${guide.app.private_key_secret}: ${setup.secret}.`);
    lines.push('Whether the App is installed on both repositories could not be checked here; the first scheduled run proves it.');
  }
  return lines;
}

function validRepositorySlug(repository) {
  return typeof repository === 'string' && repository.length <= 180 && SAFE_SLUG.test(repository) && !repository.split('/').some(part => part === '.' || part === '..');
}

// Whether one Actions variable or secret exists: { status: 200 | 404 | other }. gh prints nothing
// (--silent), so no value of either ever reaches this process.
function ghActionsMetadata({ repository, kind, name }, { spawn = require('node:child_process').spawnSync } = {}) {
  const { resolvePathExecutable } = require('./claude-process-launch.cjs');
  let result;
  try {
    result = spawn(resolvePathExecutable('gh'), ['api', '--silent', `repos/${repository}/actions/${kind === 'secret' ? 'secrets' : 'variables'}/${name}`],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 64 * 1024, windowsHide: true, shell: false });
  } catch { return { status: null }; }
  if (!result || result.error) return { status: null };
  if (result.status === 0) return { status: 200 };
  return { status: /HTTP 404/.test(String(result.stderr || '')) ? 404 : null };
}

// Whether the App's variable and secret exist, by metadata reads only: present, missing or unavailable.
// `readMetadata({ repository, kind, name })` answers { status } for one Actions variable or secret.
function checkAppSetup({ root = process.cwd(), contract = null, repository, readMetadata = ghActionsMetadata } = {}) {
  const source = contract || readCloudJobsContract({ root });
  validateCloudJobsContract(source);
  const unavailable = { variable: 'unavailable', secret: 'unavailable' };
  if (!validRepositorySlug(repository) || typeof readMetadata !== 'function') return unavailable;
  const one = (kind, name) => {
    let answer;
    try { answer = readMetadata({ repository, kind, name }); } catch { return 'unavailable'; }
    if (!isRecord(answer)) return 'unavailable';
    return answer.status === 200 ? 'present' : answer.status === 404 ? 'missing' : 'unavailable';
  };
  return { variable: one('variable', source.app.client_id_variable), secret: one('secret', source.app.private_key_secret) };
}

module.exports = Object.freeze({
  CONTRACT_PATH: CONTRACT_PATH.join('/'), CONTRACT_SCHEMA, APP, NEVER_GRANTED, PERMISSIONS,
  CloudJobsContractError, validateCloudJobsContract, readCloudJobsContract, buildCloudJobsGuide, unionPermissions, guideLines, checkAppSetup, ghActionsMetadata,
});
