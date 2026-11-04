'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../scripts/toolkit-governance-migration.cjs');
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
    ask: async () => answer,
    rulesetReader() { reads++; return { ok: true, rulesets: created ? [require('../scripts/toolkit-governance-ruleset.cjs').noForcePushRulesetBody()] : [] }; },
    rulesetCreator() { created = true; return { ok: true }; },
    protectionReader: () => ({ ok: false, reason: 'offline' }), securityReader: () => ({ ok: false, reason: 'offline' }),
    protectionWriter() { throw Error('unreadable protection cannot be changed'); }, securityWriter() { throw Error('unreadable security cannot be changed'); },
  });
  await make('yes').run([root]);
  assert.equal(reads, 0, 'pending governance cannot run maintenance');
  seedMerged(root, 'enable', { registryOptions: { registryPath: old, testOnly: true } });
  await make('no').run([root]);
  assert.equal(created, false, 'declined protection approval changes nothing');
  await make('yes').run([root]);
  assert.equal(created, true, 'approved protection remains available');
  assert.ok(reads >= 3, 'creation is read back independently');
  assert.equal(governance.governanceState(root, options).state, 'ENABLED');
  assert.equal(fs.readFileSync(old, 'utf8'), '{damaged');
});
