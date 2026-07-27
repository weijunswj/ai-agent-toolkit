#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { result, fail } = require('../protocol.cjs');

const TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function reject(code) {
  throw new Error(code);
}

function expectedTuple(phase, repositoryId, repository, prNumber, headSha) {
  if (!['initial', 'revalidate'].includes(phase)) reject('TW_REHEARSAL_PHASE');
  if (!/^[1-9][0-9]*$/.test(repositoryId)) reject('TW_REHEARSAL_REPOSITORY_ID');
  if (!REPOSITORY.test(repository)) reject('TW_REHEARSAL_REPOSITORY');
  if (!/^[1-9][0-9]*$/.test(prNumber)) reject('TW_REHEARSAL_PR');
  if (!SHA.test(headSha)) reject('TW_REHEARSAL_HEAD');
  return Object.freeze({
    phase,
    repository_id: repositoryId,
    repository,
    pr_number: Number(prNumber),
    head_sha: headSha
  });
}

function verifyRecord(record, expected) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) reject('TW_REHEARSAL_RESPONSE');
  if (record.number !== expected.pr_number) reject('TW_REHEARSAL_PR_MISMATCH');
  if (record.state !== 'open') reject('TW_REHEARSAL_NOT_OPEN');
  if (!record.base || !record.base.repo || !record.head || !record.head.repo) reject('TW_REHEARSAL_RESPONSE');
  if (String(record.base.repo.id) !== expected.repository_id) reject('TW_REHEARSAL_REPOSITORY_ID_MISMATCH');
  if (String(record.head.repo.id) !== expected.repository_id) reject('TW_REHEARSAL_FORK');
  if (String(record.base.repo.full_name) !== expected.repository ||
      String(record.head.repo.full_name) !== expected.repository) reject('TW_REHEARSAL_REPOSITORY_MISMATCH');
  if (record.base.ref !== 'main') reject('TW_REHEARSAL_BASE');
  if (record.head.sha !== expected.head_sha || !SHA.test(record.head.sha)) reject('TW_REHEARSAL_HEAD_MISMATCH');
  const tuple = {
    repository_id: expected.repository_id,
    repository: expected.repository,
    pr_number: record.number,
    head_sha: record.head.sha,
    base_ref: record.base.ref,
    state: record.state,
    same_repository: true
  };
  tuple.tuple_digest = crypto.createHash('sha256').update(JSON.stringify(tuple)).digest('hex');
  return Object.freeze(tuple);
}

function requestPullRequest(expected, token, apiUrl = 'https://api.github.com') {
  if (typeof token !== 'string' || token === '') reject('TW_REHEARSAL_TOKEN');
  let base;
  try {
    base = new URL(apiUrl);
  } catch {
    reject('TW_REHEARSAL_API');
  }
  if (base.protocol !== 'https:' || base.origin !== 'https://api.github.com' || base.pathname !== '/') {
    reject('TW_REHEARSAL_API');
  }
  const [owner, repository] = expected.repository.split('/');
  const requestPath = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repository) +
    '/pulls/' + String(expected.pr_number);
  return new Promise((resolve, rejectPromise) => {
    const request = https.request({
      protocol: 'https:',
      hostname: 'api.github.com',
      port: 443,
      method: 'GET',
      path: requestPath,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: 'Bearer ' + token,
        'user-agent': 'ai-agent-toolkit-trusted-rehearsal',
        'x-github-api-version': '2022-11-28'
      }
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        rejectPromise(new Error('TW_REHEARSAL_HTTP'));
        return;
      }
      let bytes = 0;
      const chunks = [];
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('TW_REHEARSAL_RESPONSE_SIZE'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          rejectPromise(new Error('TW_REHEARSAL_RESPONSE'));
        }
      });
    });
    request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error('TW_REHEARSAL_TIMEOUT')));
    request.on('error', (error) => {
      rejectPromise(/^TW_REHEARSAL_[A-Z_]+$/.test(error.message) ? error : new Error('TW_REHEARSAL_NETWORK'));
    });
    request.end();
  });
}

async function runVerification(expected, fetchPullRequest) {
  const record = await fetchPullRequest(expected);
  return verifyRecord(record, expected);
}

function appendOutputs(tuple, outputFile) {
  if (typeof outputFile !== 'string' || !path.isAbsolute(outputFile)) reject('TW_REHEARSAL_OUTPUT');
  let stat;
  try {
    stat = fs.lstatSync(outputFile);
  } catch {
    reject('TW_REHEARSAL_OUTPUT');
  }
  if (!stat.isFile() || stat.isSymbolicLink()) reject('TW_REHEARSAL_OUTPUT');
  const lines = [
    ['repository_id', tuple.repository_id],
    ['repository', tuple.repository],
    ['pr_number', tuple.pr_number],
    ['head_sha', tuple.head_sha],
    ['base_ref', tuple.base_ref],
    ['tuple_digest', tuple.tuple_digest]
  ].map(([name, value]) => name + '=' + String(value)).join('\n') + '\n';
  fs.appendFileSync(outputFile, lines, { encoding: 'utf8', flag: 'a' });
}

async function main() {
  if (process.argv.length !== 7) fail('TW_REHEARSAL_ARGUMENTS');
  let expected;
  try {
    expected = expectedTuple(...process.argv.slice(2));
    const tuple = await runVerification(expected, (value) => requestPullRequest(
      value,
      process.env.GITHUB_TOKEN,
      process.env.GITHUB_API_URL
    ));
    appendOutputs(tuple, process.env.GITHUB_OUTPUT);
    result({
      verified: true,
      phase: expected.phase,
      repository_id: tuple.repository_id,
      repository: tuple.repository,
      pr_number: tuple.pr_number,
      head_sha: tuple.head_sha,
      base_ref: tuple.base_ref,
      tuple_digest: tuple.tuple_digest
    });
  } catch (error) {
    fail(/^TW_REHEARSAL_[A-Z_]+$/.test(error.message) ? error.message : 'TW_REHEARSAL_INTERNAL');
  }
}

if (require.main === module) main();

module.exports = Object.freeze({
  TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  expectedTuple,
  verifyRecord,
  requestPullRequest,
  runVerification,
  appendOutputs
});
