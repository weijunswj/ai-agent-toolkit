'use strict';

// The cloud jobs contract (App shape): each row's tokens name which of the governance App's
// permissions they take, at the App's level unless marked read-only, and the lines
// `toolkit governance check` prints. The App's permission list, its display names and its levels
// exist once, in toolkit-governance-app.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const jobs = () => require(path.join(ROOT, 'repo/scripts/toolkit-cloud-jobs.cjs'));
const governanceApp = () => require(path.join(ROOT, 'repo/scripts/toolkit-governance-app.cjs'));
const contract = () => structuredClone(jobs().readCloudJobsContract({ root: ROOT }));
const OWNER = 'repo/scripts/toolkit-governance-app.cjs';

test('contract: the programme sweep row has two narrow tokens and no personal token', () => {
  const source = contract();
  assert.deepEqual(Object.keys(source), ['schema', 'never_granted', 'jobs']);
  assert.deepEqual(source.never_granted, ['administration', 'secrets', 'workflows', 'account']);
  const row = source.jobs.find(job => job.id === 'programme-sweep');
  assert.deepEqual(row.tokens, [
    { name: 'governed', repository: 'governed_repository', takes: ['contents', 'issues', 'pull_requests', 'checks', 'statuses'], read_only: ['contents'] },
    { name: 'store', repository: 'evidence_store', takes: ['contents', 'issues', 'pull_requests'] },
  ]);
  assert.deepEqual(jobs().tokenPermissions(row.tokens[0]), { contents: 'read', issues: 'write', pull_requests: 'write', checks: 'read', statuses: 'read' });
  // Issues and pull requests write let the footer cleaning edit the owner's posts in the store.
  assert.deepEqual(jobs().tokenPermissions(row.tokens[1]), { contents: 'write', issues: 'write', pull_requests: 'write' });
  assert.doesNotMatch(JSON.stringify(source), /TOOLKIT_GOVERNANCE_TOKEN|secret_name/);
});

test('L5: the sweep row names the gate that holds its hourly cron', () => {
  const row = contract().jobs.find(job => job.id === 'programme-sweep');
  assert.equal(row.schedule.workflow, '.github/workflows/toolkit-programme-sweep-gate.yml');
  assert.ok(fs.readFileSync(path.join(ROOT, row.schedule.workflow), 'utf8').includes(`- cron: '${row.schedule.cron}'`));
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, row.workflow), 'utf8'), /^\s+schedule:/m, 'the sweep itself holds no cron');
  const lines = jobs().guideLines(jobs().buildCloudJobsGuide({ root: ROOT }));
  assert.ok(lines.includes('- programme-sweep: hourly (.github/workflows/toolkit-programme-sweep.yml, started by .github/workflows/toolkit-programme-sweep-gate.yml), replaces the computer\'s toolkit-programme-sweep'), lines.join('\n'));
  // A row whose own workflow holds the cron needs no schedule workflow.
  const shard = contract().jobs.find(job => job.id === 'shard-timings');
  assert.equal(Object.hasOwn(shard.schedule, 'workflow'), false);
});

test('guide: the lines the check prints use the App\'s own names, levels and variable', () => {
  const guide = jobs().buildCloudJobsGuide({ root: ROOT });
  const lines = jobs().guideLines(guide);
  assert.equal(lines[0], 'Cloud jobs: one governance GitHub App, variable TOOLKIT_GOVERNANCE_APP_CLIENT_ID and secret TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY');
  assert.ok(lines.includes('  Governed repository token: Contents read-only, Issues read and write, Pull requests read and write, Checks read-only, Commit statuses read-only'), lines.join('\n'));
  assert.ok(lines.includes('  Evidence store token: Contents read and write, Issues read and write, Pull requests read and write'), lines.join('\n'));
  assert.ok(lines.includes('Never grant: administration, secrets, workflows, account.'));
  // The same words as the App's setup steps, from the same helper.
  const app = governanceApp();
  assert.equal(app.permissionLabel('statuses', 'read'), 'Commit statuses read-only');
  assert.match(app.setupLines('owner/repository', null, { variable: 'missing', secret: 'missing' }).join('\n'),
    /repository permissions Contents read and write, Issues read and write, Pull requests read and write, Checks read-only, Commit statuses read-only,/);
});

test('one permission list: names, display names and levels live only in the App module', () => {
  const app = governanceApp();
  const cloud = jobs();
  assert.equal(Object.hasOwn(cloud, 'PERMISSIONS'), false, 'the cloud jobs module keeps no permission map');
  assert.equal(Object.hasOwn(cloud, 'APP'), false, 'the cloud jobs module keeps no copy of the App names');
  // Every token's permissions are the App's, read from it: write only where the App has write.
  for (const job of contract().jobs) for (const token of job.tokens) {
    for (const [name, level] of Object.entries(cloud.tokenPermissions(token))) {
      assert.ok(Object.hasOwn(app.APP.permissions, name), `${job.id} ${token.name} ${name}`);
      assert.equal(level, (token.read_only || []).includes(name) ? 'read' : app.APP.permissions[name], `${job.id} ${token.name} ${name}`);
    }
  }
  // No second copy anywhere in the Toolkit's code or contracts: no "name: level" or ['name', 'level']
  // pair for an App permission, and no display-name map in either shape.
  const names = Object.keys(app.APP.permissions).join('|');
  const levelPair = new RegExp(`["']?\\b(${names})\\b["']?\\s*[:,]\\s*["'](read|write)["']`, 'g');
  const labelPair = new RegExp(`["']?\\b(${names})\\b["']?\\s*[:,]\\s*["']([A-Z][a-z]+(?: [a-z]+)?)["']`, 'g');
  const copies = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (!['node_modules', 'fixtures'].includes(entry.name)) walk(rel); continue; }
      if (!/\.(cjs|mjs|js|json)$/.test(entry.name) || rel === OWNER) continue;
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const pairs = [...text.matchAll(levelPair)].length;
      if (pairs >= 2 || [...text.matchAll(labelPair)].length >= 2 || /Commit statuses/.test(text)) copies.push(rel);
    }
  };
  for (const dir of ['repo/scripts', 'repo/contracts', 'skills']) walk(dir);
  assert.deepEqual(copies, [], 'the App permission list is copied outside its owner');
});

for (const [label, change] of [
  ['a never-granted permission', source => { source.jobs[0].tokens[0].takes.push('administration'); }],
  ['an unknown permission', source => { source.jobs[0].tokens[0].takes.push('actions'); }],
  ['a level written into the row', source => { source.jobs[0].tokens[1].permissions = { contents: 'write' }; }],
  ['a permission taken twice', source => { source.jobs[0].tokens[1].takes.push('contents'); }],
  ['read-only on a permission not taken', source => { source.jobs[0].tokens[1].read_only = ['checks']; }],
  ['read-only on a permission the App only reads', source => { source.jobs[0].tokens[0].read_only.push('checks'); }],
  ['an empty read-only list', source => { source.jobs[0].tokens[1].read_only = []; }],
  ['no permissions', source => { source.jobs[0].tokens[1].takes = []; }],
  ['two tokens for one repository', source => { source.jobs[0].tokens[1].repository = 'governed_repository'; }],
  ['a copied App block', source => { source.app = { client_id_variable: 'TOOLKIT_GOVERNANCE_APP_CLIENT_ID', private_key_secret: 'TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY' }; }],
  ['a personal token field', source => { source.secret_name = 'TOOLKIT_GOVERNANCE_TOKEN'; }],
  ['a duplicate row', source => { source.jobs.push(structuredClone(source.jobs[0])); }],
  ['a changed never-granted list', source => { source.never_granted.pop(); }],
  ['a schedule workflow that is the job\'s own', source => { source.jobs[0].schedule.workflow = source.jobs[0].workflow; }],
  ['a schedule workflow outside the workflows folder', source => { source.jobs[0].schedule.workflow = 'gate.yml'; }],
  ['an unknown schedule field', source => { source.jobs[0].schedule.runner = 'ubuntu'; }],
]) test(`contract: ${label} is refused`, () => {
  const source = contract();
  change(source);
  assert.throws(() => jobs().validateCloudJobsContract(source), jobs().CloudJobsContractError);
});
