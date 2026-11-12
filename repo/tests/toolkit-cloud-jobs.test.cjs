'use strict';

// The cloud jobs contract (App shape): one governance App, each row's tokens with exact
// permissions, the App's one-time permission union, and a setup check that reads metadata only.
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
  wider.jobs.push({ id: 'rebump', workflow: '.github/workflows/toolkit-rebump.yml', schedule: { cadence: 'on-merge', cron: '0 0 * * *' }, replaces_laptop_job: 'toolkit-rebump',
    tokens: [{ name: 'push', repository: 'governed_repository', permissions: { contents: 'write', pull_requests: 'read' } }] });
  assert.deepEqual(jobs().buildCloudJobsGuide({ contract: wider }).app_permissions.governed_repository, { contents: 'write', issues: 'write', pull_requests: 'write', checks: 'read', statuses: 'read' });
  const lines = jobs().guideLines(guide, { variable: 'present', secret: 'missing' });
  assert.ok(lines.includes('- Governed repository: Contents: read, Issues: read and write, Pull requests: read and write, Checks: read, Commit statuses: read'));
  assert.ok(lines.includes('- Evidence store: Contents: read and write'));
  assert.ok(lines.includes('App variable TOOLKIT_GOVERNANCE_APP_CLIENT_ID: present. App secret TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY: missing.'));
  assert.ok(lines.some(line => /could not be checked here; the first scheduled run proves it/.test(line)));
});

for (const [label, change] of [
  ['a never-granted permission', source => { source.jobs[0].tokens[0].permissions.administration = 'read'; }],
  ['an unknown permission', source => { source.jobs[0].tokens[0].permissions.actions = 'write'; }],
  ['an unknown level', source => { source.jobs[0].tokens[1].permissions.contents = 'admin'; }],
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

test('setup check: metadata only, present, missing or unavailable', () => {
  const asked = [];
  const answers = { variable: { status: 200 }, secret: { status: 404 } };
  const result = jobs().checkAppSetup({ root: ROOT, repository: 'owner/repository', readMetadata: query => { asked.push(query); return answers[query.kind]; } });
  assert.deepEqual(result, { variable: 'present', secret: 'missing' });
  assert.deepEqual(asked, [{ repository: 'owner/repository', kind: 'variable', name: 'TOOLKIT_GOVERNANCE_APP_CLIENT_ID' }, { repository: 'owner/repository', kind: 'secret', name: 'TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY' }]);
  assert.deepEqual(jobs().checkAppSetup({ root: ROOT, repository: 'owner/repository', readMetadata: () => { throw new Error('offline'); } }), { variable: 'unavailable', secret: 'unavailable' });
  let called = false;
  assert.deepEqual(jobs().checkAppSetup({ root: ROOT, repository: '../escape', readMetadata: () => { called = true; return { status: 200 }; } }), { variable: 'unavailable', secret: 'unavailable' });
  assert.equal(called, false, 'a hostile repository name is refused before any read');
});

test('setup check: gh prints nothing, so no value ever reaches the check', () => {
  const seen = [];
  const spawn = (file, args, options) => { seen.push({ args, options }); return args.at(-1).includes('/secrets/') ? { status: 1, stderr: 'gh: Not Found (HTTP 404)' } : { status: 0, stdout: '' }; };
  assert.deepEqual(jobs().ghActionsMetadata({ repository: 'owner/repository', kind: 'variable', name: 'TOOLKIT_GOVERNANCE_APP_CLIENT_ID' }, { spawn }), { status: 200 });
  assert.deepEqual(jobs().ghActionsMetadata({ repository: 'owner/repository', kind: 'secret', name: 'TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY' }, { spawn }), { status: 404 });
  assert.deepEqual(seen.map(call => call.args), [['api', '--silent', 'repos/owner/repository/actions/variables/TOOLKIT_GOVERNANCE_APP_CLIENT_ID'], ['api', '--silent', 'repos/owner/repository/actions/secrets/TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY']]);
  assert.ok(seen.every(call => call.options.shell === false));
});
