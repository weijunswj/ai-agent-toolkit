'use strict';

// The scheduled jobs that run on GitHub instead of on a computer. Each job row names its workflow,
// its schedule, the computer job it replaces and the installation tokens it mints from the
// governance GitHub App, one per repository, each with exactly its permissions. Every token stays
// within the App's one permission list (toolkit-governance-app.cjs owns it, its names and the
// owner's setup steps). Reading the contract is offline.
const fs = require('node:fs');
const path = require('node:path');
const governanceApp = require('./toolkit-governance-app.cjs');

const CONTRACT_PATH = Object.freeze(['repo', 'contracts', 'cloud-jobs.json']);
const CONTRACT_SCHEMA = 'toolkit.cloud-jobs.v1';
const APP = Object.freeze({ client_id_variable: governanceApp.APP.variable, private_key_secret: governanceApp.APP.secret });
const NEVER_GRANTED = Object.freeze(['administration', 'secrets', 'workflows', 'account']);
const REPOSITORY_ROLES = Object.freeze(['governed_repository', 'evidence_store']);
// GitHub App repository permissions a row may name, with the names GitHub's App settings show.
const PERMISSIONS = Object.freeze({ contents: 'Contents', issues: 'Issues', pull_requests: 'Pull requests', checks: 'Checks', statuses: 'Commit statuses' });
const LEVELS = Object.freeze(['read', 'write']);
const MAX_CONTRACT_BYTES = 128 * 1024;
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
    const allowed = governanceApp.APP.permissions[permission];
    if (!allowed || (level === 'write' && allowed !== 'write')) fail(`job ${jobId} token ${token.name} asks for more than the governance App's permissions`);
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
    if (!hasExactKeys(job, ['id', 'workflow', 'schedule', 'replaces_computer_job', 'tokens'])) fail('job row fields');
    if (!validText(job.id, /^[a-z][a-z0-9-]{0,63}$/) || ids.has(job.id)) fail('duplicate or invalid job id');
    ids.add(job.id);
    if (!validText(job.workflow, /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/)) fail(`job ${job.id} workflow path`);
    if (!hasExactKeys(job.schedule, ['cadence', 'cron']) || !validText(job.schedule.cadence, /^[a-z][a-z0-9-]{0,31}$/)
      || !validText(job.schedule.cron, CRON, 64)) fail(`job ${job.id} schedule`);
    if (!validText(job.replaces_computer_job, /^[A-Za-z0-9_-]{1,100}$/)) fail(`job ${job.id} replacement`);
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

// The guide as lines for `toolkit governance check`; the App's own setup steps print beside it.
function guideLines(guide) {
  const roles = { governed_repository: 'Governed repository', evidence_store: 'Evidence store' };
  const lines = [`Cloud jobs: one governance GitHub App, variable ${guide.app.client_id_variable} and secret ${guide.app.private_key_secret}`];
  for (const job of guide.jobs) {
    lines.push(`- ${job.id}: ${job.schedule.cadence} (${job.workflow}), replaces the computer's ${job.replaces_computer_job}`);
    for (const token of job.tokens) lines.push(`  ${roles[token.repository]} token: ${Object.entries(token.permissions).map(([name, level]) => permissionText(name, level)).join(', ')}`);
  }
  lines.push('Each job narrows its tokens to these; the App itself has the permissions its setup steps list.', `Never grant: ${guide.never_granted.join(', ')}.`);
  return lines;
}

module.exports = Object.freeze({
  CONTRACT_PATH: CONTRACT_PATH.join('/'), CONTRACT_SCHEMA, APP, NEVER_GRANTED, PERMISSIONS,
  CloudJobsContractError, validateCloudJobsContract, readCloudJobsContract, buildCloudJobsGuide, unionPermissions, guideLines,
});
