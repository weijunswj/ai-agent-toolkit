'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const contractPath = path.join(root, 'repo/contracts/cloud-jobs.json');
const fakeSecret = 'example-test-token-not-a-credential';

function api() {
  return require(path.join(root, 'repo/scripts/toolkit-cloud-jobs.cjs'));
}

test('cloud jobs contract defines the programme sweep with only its approved permissions', () => {
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const jobs = api().validateCloudJobsContract(contract);

  assert.equal(contract.secret_name, 'TOOLKIT_GOVERNANCE_TOKEN');
  assert.deepEqual(contract.never_granted, ['administration', 'secrets', 'workflows', 'account']);
  assert.deepEqual(jobs.map(job => job.id), ['programme-sweep']);
  assert.equal(jobs[0].workflow, '.github/workflows/toolkit-programme-sweep.yml');
  assert.equal(jobs[0].schedule.cadence, 'hourly');
  assert.equal(jobs[0].replaces_laptop_job, 'toolkit-programme-sweep');
  assert.deepEqual(jobs[0].permissions, {
    governed_repository: {
      issues: ['read', 'write'],
      pull_requests: ['read'],
      metadata: ['read'],
    },
    evidence_store: {
      contents: ['read', 'write'],
      metadata: ['read'],
    },
  });
});

test('guide reader lists every row and combines permissions by repository role', () => {
  const guide = api().buildCloudJobsGuide({ root });

  assert.deepEqual(guide.jobs.map(job => job.id), ['programme-sweep']);
  assert.deepEqual(guide.combined_permissions, {
    governed_repository: {
      issues: ['read', 'write'],
      pull_requests: ['read'],
      metadata: ['read'],
    },
    evidence_store: {
      contents: ['read', 'write'],
      metadata: ['read'],
    },
  });
  assert.deepEqual(guide.never_granted, ['administration', 'secrets', 'workflows', 'account']);
});

test('secret check asks only for metadata under the shared secret name', async () => {
  const calls = [];
  const result = await api().checkSecretMetadata({
    root,
    repository: 'owner/repository',
    readSecretMetadata: async query => {
      calls.push(query);
      return { status: 200, name: 'TOOLKIT_GOVERNANCE_TOKEN', created_at: '2026-01-01T00:00:00Z' };
    },
  });

  assert.deepEqual(calls, [{ repository: 'owner/repository', secret_name: 'TOOLKIT_GOVERNANCE_TOKEN' }]);
  assert.deepEqual(result, { status: 'present', secret_name: 'TOOLKIT_GOVERNANCE_TOKEN' });
  assert.equal(JSON.stringify(result).includes(fakeSecret), false);
});

test('secret check distinguishes missing metadata from unavailable reads without exposing errors', async () => {
  const apiModule = api();
  const missing = await apiModule.checkSecretMetadata({
    root,
    repository: 'owner/repository',
    readSecretMetadata: async () => ({ status: 404 }),
  });
  const unavailable = await apiModule.checkSecretMetadata({
    root,
    repository: 'owner/repository',
    readSecretMetadata: async () => { throw new Error(`private response ${fakeSecret}`); },
  });

  assert.deepEqual(missing, { status: 'missing', secret_name: 'TOOLKIT_GOVERNANCE_TOKEN' });
  assert.deepEqual(unavailable, { status: 'unavailable', secret_name: 'TOOLKIT_GOVERNANCE_TOKEN' });
  assert.equal(JSON.stringify(unavailable).includes(fakeSecret), false);
});

test('secret check refuses hostile repository identifiers before its injected reader runs', async () => {
  const calls = [];
  for (const repository of ['owner/repo\n--jq .value', 'owner/../other', 'owner/repo?ref=main', 'оwner/repo']) {
    const result = await api().checkSecretMetadata({
      root,
      repository,
      readSecretMetadata: async query => { calls.push(query); return { status: 200, name: 'TOOLKIT_GOVERNANCE_TOKEN' }; },
    });
    assert.deepEqual(result, { status: 'unavailable', secret_name: 'TOOLKIT_GOVERNANCE_TOKEN' });
  }
  assert.deepEqual(calls, []);
});

test('contract reader rejects duplicate rows and unapproved or secret-bearing fields', () => {
  const cloudJobs = api();
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const duplicate = structuredClone(contract);
  duplicate.jobs.push(structuredClone(duplicate.jobs[0]));
  assert.throws(() => cloudJobs.validateCloudJobsContract(duplicate), /invalid|duplicate/i);

  const excessPermission = structuredClone(contract);
  excessPermission.jobs[0].permissions.governed_repository.administration = ['read'];
  assert.throws(() => cloudJobs.validateCloudJobsContract(excessPermission), /invalid|permission/i);

  const leakedValue = structuredClone(contract);
  leakedValue.jobs[0].secret_value = fakeSecret;
  assert.throws(() => cloudJobs.validateCloudJobsContract(leakedValue), /invalid|field/i);
});

