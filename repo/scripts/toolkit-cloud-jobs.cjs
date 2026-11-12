'use strict';

// The scheduled jobs that run on GitHub instead of on a computer. Each job row names its workflow,
// its schedule, the computer job it replaces and the installation tokens it mints from the
// governance GitHub App, one per repository. A token names only which of the App's permissions it
// takes; each gets the App's level unless the row marks it read-only. The App's permission list, its
// display names, levels, variable and secret live once, in toolkit-governance-app.cjs. Reading the
// contract is offline.
const fs = require('node:fs');
const path = require('node:path');
const governanceApp = require('./toolkit-governance-app.cjs');

const CONTRACT_PATH = Object.freeze(['repo', 'contracts', 'cloud-jobs.json']);
const CONTRACT_SCHEMA = 'toolkit.cloud-jobs.v1';
const NEVER_GRANTED = Object.freeze(['administration', 'secrets', 'workflows', 'account']);
const REPOSITORY_ROLES = Object.freeze(['governed_repository', 'evidence_store']);
const MAX_CONTRACT_BYTES = 128 * 1024;
const CRON = /^[0-9*/,-]+(?: [0-9*/,-]+){4}$/;

class CloudJobsContractError extends Error {}

function fail(reason) { throw new CloudJobsContractError(`Cloud jobs contract is invalid: ${reason}.`); }
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasExactKeys = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validText = (value, pattern, maxLength = 180) => typeof value === 'string' && value.length > 0 && value.length <= maxLength && pattern.test(value);
const uniqueList = value => Array.isArray(value) && value.length > 0 && new Set(value).size === value.length;

function validateToken(token, jobId, names) {
  const keys = ['name', 'repository', 'takes'];
  if (!hasExactKeys(token, keys) && !hasExactKeys(token, [...keys, 'read_only'])) fail(`job ${jobId} token fields`);
  if (!validText(token.name, /^[a-z][a-z0-9-]{0,31}$/) || names.has(token.name)) fail(`job ${jobId} duplicate or invalid token name`);
  names.add(token.name);
  if (!REPOSITORY_ROLES.includes(token.repository)) fail(`job ${jobId} token ${token.name} repository`);
  if (!uniqueList(token.takes)) fail(`job ${jobId} token ${token.name} permissions`);
  for (const permission of token.takes) {
    if (!Object.hasOwn(governanceApp.APP.permissions, permission)) fail(`job ${jobId} token ${token.name} asks for a permission the governance App does not have`);
  }
  if (!Object.hasOwn(token, 'read_only')) return;
  if (!uniqueList(token.read_only)) fail(`job ${jobId} token ${token.name} read-only permissions`);
  for (const permission of token.read_only) {
    if (!token.takes.includes(permission) || governanceApp.APP.permissions[permission] !== 'write') fail(`job ${jobId} token ${token.name} read-only ${permission} narrows nothing`);
  }
}

function validateCloudJobsContract(contract) {
  if (!hasExactKeys(contract, ['schema', 'never_granted', 'jobs'])) fail('top-level fields');
  if (contract.schema !== CONTRACT_SCHEMA) fail('schema');
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

// A validated token's permissions with their levels, read from the App: { issues: 'write', ... }.
function tokenPermissions(token) {
  return Object.fromEntries(token.takes.map(name => [name, (token.read_only || []).includes(name) ? 'read' : governanceApp.APP.permissions[name]]));
}

function buildCloudJobsGuide({ root = process.cwd(), contract = null } = {}) {
  const source = contract || readCloudJobsContract({ root });
  const jobs = validateCloudJobsContract(source);
  return { jobs: jobs.map(job => structuredClone(job)), never_granted: [...source.never_granted] };
}

// The guide as lines for `toolkit governance check`; the App's own setup steps print beside it.
function guideLines(guide) {
  const roles = { governed_repository: 'Governed repository', evidence_store: 'Evidence store' };
  const lines = [`Cloud jobs: one governance GitHub App, variable ${governanceApp.APP.variable} and secret ${governanceApp.APP.secret}`];
  for (const job of guide.jobs) {
    lines.push(`- ${job.id}: ${job.schedule.cadence} (${job.workflow}), replaces the computer's ${job.replaces_computer_job}`);
    for (const token of job.tokens) {
      lines.push(`  ${roles[token.repository]} token: ${Object.entries(tokenPermissions(token)).map(([name, level]) => governanceApp.permissionLabel(name, level)).join(', ')}`);
    }
  }
  lines.push('Each job narrows its tokens to these; the App itself has the permissions its setup steps list.', `Never grant: ${guide.never_granted.join(', ')}.`);
  return lines;
}

module.exports = Object.freeze({
  CloudJobsContractError, validateCloudJobsContract, readCloudJobsContract, tokenPermissions, buildCloudJobsGuide, guideLines,
});
