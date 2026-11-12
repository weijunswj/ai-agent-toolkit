'use strict';

// The cloud shard timing refresh: the workflow's triggers and tokens, and its row in the cloud
// jobs contract.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const workflowPath = path.join(ROOT, '.github/workflows/toolkit-shard-timings.yml');
const cloudJobs = () => require(path.join(ROOT, 'repo/scripts/toolkit-cloud-jobs.cjs'));
const workflow = () => fs.readFileSync(workflowPath, 'utf8');
const step = name => {
  const text = workflow();
  const at = text.indexOf(`- name: ${name}`);
  const end = text.indexOf('\n      - name:', at + 1);
  return text.slice(at, end === -1 ? undefined : end);
};

test('shard timings workflow: daily and by hand only, never for pull requests, forks or other workflows', () => {
  const text = workflow();
  assert.match(text, /^on:\r?\n  schedule:\r?\n    - cron: '37 2 \* \* \*'\r?\n  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(text, /^\s+(pull_request|pull_request_target|push|workflow_run|repository_dispatch|issue_comment):/m);
  assert.match(text, /concurrency:\r?\n  group: toolkit-shard-timings-\$\{\{ github\.repository \}\}\r?\n  cancel-in-progress: false/);
  assert.match(text, /timeout-minutes: 15/);
});

test('shard timings workflow: the built-in token only reads; the checkout keeps no credentials; actions are pinned', () => {
  const text = workflow();
  assert.match(text, /^permissions:\r?\n  contents: read\s*$/m);
  assert.match(text, /^    permissions:\r?\n      contents: read\r?\n      actions: read\r?\n      pull-requests: read\s*$/m);
  assert.doesNotMatch(text, /^\s+(contents|actions|pull-requests|issues|checks|statuses|id-token|packages|deployments): write\s*$/m, 'no write scope on the built-in token');
  assert.match(text, /persist-credentials: false/);
  for (const uses of text.match(/^\s+uses: \S+/gm)) assert.match(uses, /@[0-9a-f]{40}$/, `${uses.trim()} is pinned by commit`);
});

test('shard timings workflow: the App token is minted for this repository with the row\'s permissions and reaches only the refresh step', () => {
  const row = cloudJobs().readCloudJobsContract({ root: ROOT }).jobs.find(job => job.id === 'shard-timings');
  assert.ok(row, 'the contract lists the job');
  assert.equal(row.workflow, '.github/workflows/toolkit-shard-timings.yml');
  assert.equal(row.schedule.cron, '37 2 * * *');
  assert.equal(row.replaces_computer_job, 'toolkit-shard-timings');
  const mint = step('Mint the publish token');
  const minted = Object.fromEntries([...mint.matchAll(/permission-([a-z-]+): (read|write)/g)].map(([, permission, level]) => [permission.replace(/-/g, '_'), level]));
  assert.deepEqual(minted, cloudJobs().tokenPermissions(row.tokens.find(token => token.repository === 'governed_repository')));
  assert.deepEqual(minted, { contents: 'write', pull_requests: 'write' });
  assert.doesNotMatch(mint, /owner:|repositories:/, 'the token is for this repository alone');
  assert.match(mint, /continue-on-error: true/);
  const text = workflow();
  assert.equal((text.match(/steps\.app\.outputs\.token/g) || []).length, 1, 'one step receives the App token');
  assert.match(step('Refresh the shard timings'), /TOOLKIT_SHARD_PUBLISH_TOKEN: \$\{\{ steps\.app\.outputs\.token \}\}/);
  assert.equal((text.match(/secrets\.TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY/g) || []).length, 1, 'only the mint step reads the key');
});

test('shard timings workflow: without the App it only reports; with it it opens at most one pull request', () => {
  const refresh = step('Refresh the shard timings');
  assert.match(refresh, /GH_TOKEN: \$\{\{ github\.token \}\}/, 'reads use the built-in token');
  assert.match(refresh, /if \[ -z "\$TOOLKIT_SHARD_PUBLISH_TOKEN" \]; then[\s\S]*node repo\/scripts\/refresh-shard-timings\.cjs\r?\n[\s\S]*exit \$\?/);
  assert.match(refresh, /node repo\/scripts\/refresh-shard-timings\.cjs --open-pr\s*$/);
  assert.doesNotMatch(refresh, /echo "\$TOOLKIT_SHARD_PUBLISH_TOKEN"|set -x/, 'the token is never printed');
});

test('shard timings workflow: a configured App that cannot sign in fails the run instead of passing as report-only', () => {
  const refresh = step('Refresh the shard timings');
  assert.match(refresh, /MINT_OUTCOME: \$\{\{ steps\.app\.outcome \}\}/);
  const failed = refresh.indexOf('if [ "$MINT_OUTCOME" = "failure" ]; then');
  const empty = refresh.indexOf('if [ -z "$TOOLKIT_SHARD_PUBLISH_TOKEN" ]; then');
  assert.ok(failed > 0 && failed < empty, 'the sign-in failure is checked before the no-App case');
  const branch = refresh.slice(failed, empty);
  assert.match(branch, /::error::.*TOOLKIT_GOVERNANCE_APP_CLIENT_ID.*TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY/);
  assert.match(branch, /exit 1/);
  assert.doesNotMatch(branch, /--open-pr/);
  // The git header carrying the App token is masked before anything can print it.
  assert.ok(refresh.indexOf('::add-mask::') > empty && refresh.indexOf('::add-mask::') < refresh.indexOf('--open-pr'));
});
