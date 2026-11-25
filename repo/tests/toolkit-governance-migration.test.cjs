'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../scripts/toolkit-governance-migration.cjs');
const ruleset = require('../scripts/toolkit-governance-ruleset.cjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-operation-history-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { stateDirectory: directory, testOnly: true };
}
test('automatic local-decision migration and writer APIs are retired', () => {
  assert.equal(runtime.GovernanceMigration, undefined);
  assert.equal(runtime.proposalFor, undefined);
});
test('settings-operation history retains historical recovery records without governance authority', t => {
  const options = fixture(t), file = path.join(options.stateDirectory, runtime.RECORD_BASENAME);
  const old = { at: '2026-01-01T00:00:00Z', decisions: [{ result: 'written' }], securities: [{ result: 'unverified' }] };
  fs.writeFileSync(file, JSON.stringify({ schema: 'toolkit.governance-migration.v1', runs: [old] }));
  const next = { command: 'security', securities: [{ result: 'verified' }] };
  runtime.appendRunRecord(options, next);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).runs, [old, next]);
  assert.equal(fs.existsSync(path.join(options.stateDirectory, 'repository-governance.v1.json')), false);
});
test('unreadable settings history is preserved, never silently replaced', t => {
  const options = fixture(t), file = path.join(options.stateDirectory, runtime.RECORD_BASENAME);
  for (const text of ['{damaged', JSON.stringify({ schema: 'foreign', runs: [] })]) {
    fs.writeFileSync(file, text);
    assert.throws(() => runtime.appendRunRecord(options, { command: 'security' }), /OPERATION_HISTORY_UNREADABLE/);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
  }
});

test('protection maintenance keeps its own approval/readback and never reads laptop answers', async t => {
  const options = fixture(t), root = path.join(options.stateDirectory, 'repo');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'config'), '[remote "origin"]\n url = https://github.com/example-owner/maintenance.git\n');
  const governance = require('../scripts/toolkit-governance-state.cjs');
  const { recordAbsent } = require('./toolkit-governed-fixture-support.cjs');
  const { seedMerged } = require('./support/governance-observations.cjs');
  const old = path.join(options.stateDirectory, 'repository-governance.v1.json');
  fs.writeFileSync(old, '{damaged');
  recordAbsent(root, { registryPath: old });
  let created = false, reads = 0;
  const make = answer => new runtime.GovernanceMaintenance({ stdout: { write() {} }, interactive: true, registryOptions: options,
    confirm: async () => answer,
    rulesetReader() { reads++; return { ok: true, rulesets: created ? [require('../scripts/toolkit-governance-ruleset.cjs').noForcePushRulesetBody()] : [] }; },
    rulesetCreator() { created = true; return { ok: true }; },
    protectionReader: () => ({ ok: false, reason: 'offline' }), securityReader: () => ({ ok: false, reason: 'offline' }),
    protectionWriter() { throw Error('unreadable protection cannot be changed'); }, securityWriter() { throw Error('unreadable security cannot be changed'); },
  });
  await make(true).run([root]);
  assert.equal(reads, 0, 'pending governance cannot run maintenance');
  seedMerged(root, 'enable', { registryOptions: { registryPath: old, testOnly: true } });
  await make(false).run([root]);
  assert.equal(created, false, 'declined protection approval changes nothing');
  await make(true).run([root]);
  assert.equal(created, true, 'approved protection remains available');
  assert.ok(reads >= 3, 'creation is read back independently');
  assert.equal(governance.governanceState(root, options).state, 'ENABLED');
  assert.equal(fs.readFileSync(old, 'utf8'), '{damaged');
});

// The three changes `migrate` offers after its reads (no-force-push ruleset, programme state ruleset,
// default-branch protection) are one question, answered once. GitHub is a fake: `github.rulesets` are
// the rulesets it holds, `github.protection` its default-branch read (drifted until the protection
// write, then conformant) and `github.writes` every write in order.
const DRIFTED_PROTECTION = { ok: true, default_branch: 'main', repository: { allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false }, rules: [], classic: null, toolkit_ruleset: null };
const CONFORMANT_PROTECTION = { ok: true, default_branch: 'main', repository: { allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false },
  rules: [
    { type: 'required_status_checks', ruleset_id: 9, parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'validate', integration_id: 15368 }] } },
    { type: 'pull_request', ruleset_id: 9, parameters: { allowed_merge_methods: ['merge'] } },
  ], classic: null, toolkit_ruleset: { id: 9 } };

// A governed repository whose merged binding requires `validate` (and keeps programme state on the state
// branch when `state`), with one workflow job that produces `validate` on every pull request.
function governedRepo(options, registryOptions, { state }) {
  const { recordMerged } = require('./toolkit-governed-fixture-support.cjs');
  const root = path.join(options.stateDirectory, 'repo');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'config'), '[remote "origin"]\n url = https://github.com/example-owner/example-repo.git\n');
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'on:\n  pull_request:\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n');
  const binding = { schema: 'toolkit.programme-binding.v2', repository: 'example-owner/example-repo', governance: 'enabled', parents: [{ issue: 1, record_prefix: 'INT-FX-' }],
    store: { kind: 'github', repository: 'example-owner/evidence-store', branch: 'main', path: 'state/' }, required_checks: ['validate'],
    ...(state ? { state: { kind: 'branch', branch: ruleset.STATE_BRANCH, path: 'state/' } } : {}) };
  recordMerged(root, { registryPath: registryOptions.registryPath, text: JSON.stringify(binding) });
  return root;
}

// `migrate` (GovernanceMaintenance.run) on that repository, answering its one question with `answer`.
async function maintenanceRun(t, { state = true, protection = 'drifted', answer = true }) {
  const options = fixture(t), registryOptions = { registryPath: path.join(options.stateDirectory, 'repository-governance.v1.json'), testOnly: true };
  const root = governedRepo(options, registryOptions, { state });
  const github = { rulesets: [], writes: [], protection: protection === 'drifted' ? DRIFTED_PROTECTION : CONFORMANT_PROTECTION };
  const asked = [], out = [];
  const code = await new runtime.GovernanceMaintenance({
    stdout: { write: text => { out.push(String(text)); return true; } }, interactive: true, registryOptions,
    confirm: async question => { asked.push(question); return answer; },
    rulesetReader: () => ({ ok: true, rulesets: github.rulesets }),
    rulesetCreator: () => { github.rulesets.push(ruleset.noForcePushRulesetBody()); github.writes.push('no-force-push'); return { ok: true, id: 1 }; },
    stateRulesetCreator: () => { github.rulesets.push(ruleset.keepStateRulesetBody()); github.writes.push('keep-state'); return { ok: true, id: 2 }; },
    protectionReader: () => github.protection,
    protectionWriter: () => { github.writes.push('protection'); github.protection = CONFORMANT_PROTECTION; return { ok: true, id: 9 }; },
    securityReader: () => ({ ok: false, reason: 'offline' }),
    securityWriter() { throw Error('no security setting is written in this test'); },
    securityFileWriter() { throw Error('no security file is written in this test'); },
  }).run([root]);
  return { code, asked, out: out.join(''), github };
}

test('with all three needed, one Enter is asked and yes applies each of the three in order', async t => {
  const { asked, out, github } = await maintenanceRun(t, { state: true, protection: 'drifted', answer: true });
  assert.equal(asked.length, 1, `one Enter for all three, asked ${asked.length} times: ${asked.join(' | ')}`);
  assert.deepEqual(github.writes, ['no-force-push', 'keep-state', 'protection']);
  assert.equal(github.rulesets.length, 2);
  assert.equal((out.match(/and read back/g) || []).length, 3, 'each write is read back');
});

test('a single no writes none of the three and says so once', async t => {
  const { asked, out, github } = await maintenanceRun(t, { state: true, protection: 'drifted', answer: false });
  assert.equal(asked.length, 1, `one Enter for all three, asked ${asked.length} times`);
  assert.deepEqual(github.writes, []);
  assert.equal(github.rulesets.length, 0);
  assert.equal(out.split('No rulesets or default-branch protection were added.').length - 1, 1, 'said once');
  // 1460 G2 L5: the question no longer implies a no writes nothing, since the free security step still runs.
  assert.match(out, /No ruleset or default-branch protection is written until you answer once; the free dependency and security settings are turned on either way:/);
  assert.doesNotMatch(out, /Nothing is written until you answer/);
});

test('the one Enter covers only the changes that need something', async t => {
  const rulesetOnly = await maintenanceRun(t, { state: false, protection: 'conformant', answer: true });
  assert.equal(rulesetOnly.asked.length, 1);
  assert.match(rulesetOnly.asked[0], /"Toolkit: no force pushes"/);
  assert.doesNotMatch(rulesetOnly.asked[0], /programme state|protected default branch/);
  const withState = await maintenanceRun(t, { state: true, protection: 'conformant', answer: true });
  assert.equal(withState.asked.length, 1);
  assert.match(withState.asked[0], /"Toolkit: no force pushes"/);
  assert.match(withState.asked[0], /"Toolkit: keep programme state"/);
  assert.doesNotMatch(withState.asked[0], /protected default branch/);
  assert.deepEqual(withState.github.writes, ['no-force-push', 'keep-state']);
});
