'use strict';

// The cloud jobs contract (App shape): each row's tokens with exact permissions, all within the
// governance App's one permission list, and the lines `toolkit governance check` prints.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const jobs = () => require(path.join(ROOT, 'repo/scripts/toolkit-cloud-jobs.cjs'));
const contract = () => structuredClone(jobs().readCloudJobsContract({ root: ROOT }));

test('contract: the programme sweep row has two narrow tokens and no personal token', () => {
  const source = contract();
  assert.deepEqual(source.app, { client_id_variable: 'TOOLKIT_GOVERNANCE_APP_CLIENT_ID', private_key_secret: 'TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY' });
  assert.deepEqual(source.never_granted, ['administration', 'secrets', 'workflows', 'account']);
  const row = source.jobs.find(job => job.id === 'programme-sweep');
  assert.deepEqual(row.tokens, [
    { name: 'governed', repository: 'governed_repository', permissions: { issues: 'write', pull_requests: 'write', contents: 'read', checks: 'read', statuses: 'read' } },
    { name: 'store', repository: 'evidence_store', permissions: { contents: 'write' } },
  ]);
  assert.doesNotMatch(JSON.stringify(source), /TOOLKIT_GOVERNANCE_TOKEN|secret_name/);
});

test('guide: the App permission union and the lines the check prints', () => {
  const guide = jobs().buildCloudJobsGuide({ root: ROOT });
  assert.deepEqual(guide.app_permissions, {
    governed_repository: { contents: 'read', issues: 'write', pull_requests: 'write', checks: 'read', statuses: 'read' },
    evidence_store: { contents: 'write' },
  });
  // A second row widens the union to the highest level each asks for, per repository.
  const wider = contract();
  wider.jobs.push({ id: 'rebump', workflow: '.github/workflows/toolkit-rebump.yml', schedule: { cadence: 'on-merge', cron: '0 0 * * *' }, replaces_computer_job: 'toolkit-rebump',
    tokens: [{ name: 'push', repository: 'governed_repository', permissions: { contents: 'write', pull_requests: 'read' } }] });
  assert.deepEqual(jobs().buildCloudJobsGuide({ contract: wider }).app_permissions.governed_repository, { contents: 'write', issues: 'write', pull_requests: 'write', checks: 'read', statuses: 'read' });
  const lines = jobs().guideLines(guide);
  assert.ok(lines.includes('  Governed repository token: Issues: read and write, Pull requests: read and write, Contents: read, Checks: read, Commit statuses: read'));
  assert.ok(lines.includes('  Evidence store token: Contents: read and write'));
  assert.ok(lines.includes('Never grant: administration, secrets, workflows, account.'));
  // Every token stays within the App's one list, which the App's setup steps print.
  const app = require(path.join(ROOT, 'repo/scripts/toolkit-governance-app.cjs')).APP;
  for (const job of guide.jobs) for (const token of job.tokens) for (const [name, level] of Object.entries(token.permissions)) {
    assert.ok(app.permissions[name] === 'write' || (level === 'read' && app.permissions[name] === 'read'), `${job.id} ${token.name} ${name}`);
  }
});

for (const [label, change] of [
  ['a never-granted permission', source => { source.jobs[0].tokens[0].permissions.administration = 'read'; }],
  ['an unknown permission', source => { source.jobs[0].tokens[0].permissions.actions = 'write'; }],
  ['an unknown level', source => { source.jobs[0].tokens[1].permissions.contents = 'admin'; }],
  ['more than the App has', source => { source.jobs[0].tokens[1].permissions.checks = 'write'; }],
  ['two tokens for one repository', source => { source.jobs[0].tokens[1].repository = 'governed_repository'; }],
  ['another App variable', source => { source.app.client_id_variable = 'OTHER_CLIENT_ID'; }],
  ['a personal token field', source => { source.secret_name = 'TOOLKIT_GOVERNANCE_TOKEN'; }],
  ['a duplicate row', source => { source.jobs.push(structuredClone(source.jobs[0])); }],
  ['a changed never-granted list', source => { source.never_granted.pop(); }],
]) test(`contract: ${label} is refused`, () => {
  const source = contract();
  change(source);
  assert.throws(() => jobs().validateCloudJobsContract(source), jobs().CloudJobsContractError);
});
