'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  RECORD_PREFIX,
  auditOwnedStaging,
  cleanupOwnedGeneration,
  createOwnedStagingGeneration,
  inspectOwnedGeneration,
  markOwnedStaging,
  reconcileOwnedStaging
} = require('../scripts/toolkit-staging-generations.cjs');

const bridgeVersion = '2.5.3';

function fixtureRoot(label = '') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `toolkit owned staging ${label}-`));
}

function createGeneration(parent, targetName = 'current', overrides = {}) {
  return createOwnedStagingGeneration({
    parent,
    target: path.join(parent, targetName),
    operation: 'hub-snapshot-replacement',
    sourceType: 'repo',
    bridgeVersion,
    ...overrides
  });
}

function deadLiveness() {
  return 'dead';
}

function generationIdFor(index) {
  const hex = index.toString(16);
  return `${hex.padStart(8, '0')}-0000-4000-8000-${hex.padStart(12, '0')}`;
}

function writeUnrelatedGenerationRecords(parent, count) {
  fs.mkdirSync(parent, { recursive: true });
  for (let index = 1; index <= count; index += 1) {
    fs.writeFileSync(path.join(parent, `${RECORD_PREFIX}${generationIdFor(index)}.json`), '{}\n');
  }
}

test('initialization cleanup preserves an interposed unowned directory and sentinel after EEXIST', () => {
  const parent = fixtureRoot('interposed');
  let registered;
  const sentinelBytes = Buffer.from('unowned sentinel bytes\n');
  let error;
  try {
    createGeneration(parent, 'current', {
      afterRegistration(context) {
        registered = context;
        fs.mkdirSync(context.stagePath);
        fs.writeFileSync(path.join(context.stagePath, 'sentinel.bin'), sentinelBytes);
      }
    });
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.code, 'EEXIST');
  assert.match(error.message, /preserved because initialization cleanup was indeterminate/);
  assert.deepEqual(fs.readFileSync(path.join(registered.stagePath, 'sentinel.bin')), sentinelBytes);
  assert.equal(fs.existsSync(registered.recordPath), true);
  const audit = auditOwnedStaging([parent], { liveness: deadLiveness });
  assert.equal(audit.entries[0].classification, 'indeterminate');
  assert.equal(audit.entries[0].safe_to_reconcile, false);
  assert.deepEqual(fs.readFileSync(path.join(registered.stagePath, 'sentinel.bin')), sentinelBytes);
});

test('handled initialization failure cleans an unmarked directory only when this invocation created and identified it', () => {
  const parent = fixtureRoot('owned-init-failure');
  let created;
  assert.throws(() => createGeneration(parent, 'current', {
    afterDirectoryCreated(context) {
      created = context;
      throw new Error('injected handled initialization failure');
    }
  }), /injected handled initialization failure/);
  assert.equal(fs.existsSync(created.stagePath), false);
  assert.equal(fs.existsSync(created.recordPath), false);
});

test('abrupt interruption between mkdir and ready marker stays attributable but cannot be reconciled', () => {
  const parent = fixtureRoot('abrupt-before-ready');
  let created;
  assert.throws(() => createGeneration(parent, 'current', {
    preserveOnInitializationError: true,
    afterDirectoryCreated(context) {
      created = context;
      throw new Error('simulated abrupt interruption before ready marker');
    }
  }), /simulated abrupt interruption/);
  assert.equal(fs.existsSync(created.stagePath), true);
  assert.equal(fs.existsSync(created.recordPath), true);
  const audit = auditOwnedStaging([parent], { liveness: deadLiveness });
  assert.equal(audit.entries[0].classification, 'indeterminate');
  const reconciliation = reconcileOwnedStaging([parent], created.record.generation_id, { write: true, liveness: deadLiveness });
  assert.equal(reconciliation.reconciled, false);
  assert.match(reconciliation.reason, /generation-not-safe:indeterminate/);
  assert.equal(fs.existsSync(created.stagePath), true);
});

test('an interrupted new-format generation remains attributable, auditable, exactly reconcilable, and idempotent', () => {
  const parent = path.join(fixtureRoot('interrupt'), 'managed root with spaces');
  fs.mkdirSync(parent, { recursive: true });
  const generation = createGeneration(parent);
  fs.writeFileSync(path.join(generation.stagePath, 'partial-private-payload.txt'), 'secret payload that diagnostics must not print\n');

  const audit = auditOwnedStaging([parent], { liveness: deadLiveness });
  assert.equal(audit.entries.length, 1);
  assert.equal(audit.entries[0].classification, 'dead-owned');
  assert.equal(audit.entries[0].generation_id, generation.record.generation_id);
  assert.doesNotMatch(JSON.stringify(audit), /secret payload/);

  const dryRun = reconcileOwnedStaging([parent], generation.record.generation_id, { liveness: deadLiveness });
  assert.equal(dryRun.dry_run, true);
  assert.equal(dryRun.would_reconcile, true);
  assert.equal(fs.existsSync(generation.stagePath), true);

  const write = reconcileOwnedStaging([parent], generation.record.generation_id, { write: true, liveness: deadLiveness });
  assert.equal(write.reconciled, true);
  assert.equal(fs.existsSync(generation.stagePath), false);
  assert.equal(fs.existsSync(generation.recordPath), false);

  const emptyApprovedParent = fixtureRoot('second-approved-parent');
  const rerun = reconcileOwnedStaging([parent, emptyApprovedParent], generation.record.generation_id, { write: true, liveness: deadLiveness });
  assert.equal(rerun.reconciled, false);
  assert.equal(rerun.reason, 'generation-id-not-found');
  assert.equal(rerun.exact_lookup.checked_parents.length, 2);
});

test('exact lookup locates and reconciles a generation despite a truncated supplemental audit', () => {
  const parent = fixtureRoot('audit-truncation');
  writeUnrelatedGenerationRecords(parent, 205);
  const requested = createGeneration(parent);
  fs.writeFileSync(path.join(requested.stagePath, 'requested-only.txt'), 'requested generation\n');

  const preview = reconcileOwnedStaging([parent], requested.record.generation_id, {
    liveness: deadLiveness,
    auditLimit: 10
  });
  assert.equal(preview.audit.truncated, true);
  assert.equal(preview.would_reconcile, true);
  assert.equal(preview.generation.generation_id, requested.record.generation_id);

  const approved = reconcileOwnedStaging([parent], requested.record.generation_id, {
    write: true,
    liveness: deadLiveness,
    auditLimit: 10
  });
  assert.equal(approved.audit.truncated, true);
  assert.equal(approved.reconciled, true);
  assert.equal(fs.existsSync(requested.stagePath), false);
  assert.equal(fs.existsSync(path.join(parent, `${RECORD_PREFIX}${generationIdFor(205)}.json`)), true);
});

test('exact lookup refuses duplicate generation IDs across approved parents even when audit is truncated', () => {
  const parentA = fixtureRoot('duplicate-a');
  const parentB = fixtureRoot('duplicate-b');
  writeUnrelatedGenerationRecords(parentA, 205);
  const duplicateId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const generationA = createGeneration(parentA, 'current-a', { generationId: duplicateId });
  const generationB = createGeneration(parentB, 'current-b', { generationId: duplicateId });

  const result = reconcileOwnedStaging([parentA, parentB], duplicateId, {
    write: true,
    liveness: deadLiveness,
    auditLimit: 10
  });
  assert.equal(result.audit.truncated, true);
  assert.equal(result.reconciled, false);
  assert.equal(result.reason, 'generation-id-ambiguous');
  assert.equal(result.exact_lookup.candidates.length, 2);
  assert.equal(fs.existsSync(generationA.stagePath), true);
  assert.equal(fs.existsSync(generationB.stagePath), true);
});

test('write reconciliation rechecks all approved parents after supplemental audit', () => {
  const parentA = fixtureRoot('post-audit-duplicate-a');
  const parentB = fixtureRoot('post-audit-duplicate-b');
  const generationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const generationA = createGeneration(parentA, 'current-a', { generationId });
  let generationB;
  const result = reconcileOwnedStaging([parentA, parentB], generationId, {
    write: true,
    liveness: deadLiveness,
    afterSupplementalAudit() {
      generationB = createGeneration(parentB, 'current-b', { generationId });
    }
  });
  assert.equal(result.reconciled, false);
  assert.equal(result.reason, 'generation-id-ambiguous');
  assert.equal(fs.existsSync(generationA.stagePath), true);
  assert.equal(fs.existsSync(generationB.stagePath), true);
});

test('completed replacement metadata without staging is safely classified and cleaned', () => {
  const parent = fixtureRoot('completed');
  const generation = createGeneration(parent);
  fs.renameSync(generation.stagePath, generation.record.expected_final_target);
  markOwnedStaging(generation, 'completed');

  const inspection = inspectOwnedGeneration(generation.recordPath, { expectedParent: parent, liveness: deadLiveness });
  assert.equal(inspection.classification, 'completed-awaiting-cleanup');
  assert.equal(inspection.safe_to_reconcile, true);
  const cleanup = reconcileOwnedStaging([parent], generation.record.generation_id, { write: true, liveness: deadLiveness });
  assert.equal(cleanup.reconciled, true);
  assert.equal(fs.existsSync(generation.record.expected_final_target), true, 'final target is never removed by staging cleanup');
});

test('live owners, PID reuse, and indeterminate liveness all fail closed', () => {
  for (const [label, liveness, expected] of [
    ['live', () => 'alive', 'live-owned'],
    ['pid-reuse', () => 'alive', 'live-owned'],
    ['indeterminate', () => 'indeterminate', 'indeterminate']
  ]) {
    const parent = fixtureRoot(label);
    const generation = createGeneration(parent, 'current', { pid: 4242 });
    const audit = auditOwnedStaging([parent], { liveness });
    assert.equal(audit.entries[0].classification, expected);
    const result = reconcileOwnedStaging([parent], generation.record.generation_id, { write: true, liveness });
    assert.equal(result.reconciled, false);
    assert.equal(fs.existsSync(generation.stagePath), true);
  }
});

test('ownership token mismatch and ownership replacement between audit and deletion abort cleanup', () => {
  const tokenParent = fixtureRoot('token');
  const tokenGeneration = createGeneration(tokenParent);
  const readyPath = tokenGeneration.recordPath.replace(/\.json$/, '.ready.json');
  const ready = JSON.parse(fs.readFileSync(readyPath, 'utf8'));
  ready.ownership_token = '0'.repeat(48);
  fs.writeFileSync(readyPath, `${JSON.stringify(ready, null, 2)}\n`);
  const mismatch = inspectOwnedGeneration(tokenGeneration.recordPath, { expectedParent: tokenParent, liveness: deadLiveness });
  assert.equal(mismatch.classification, 'ownership-mismatched');
  assert.equal(fs.existsSync(tokenGeneration.stagePath), true);

  const raceParent = fixtureRoot('race');
  const raceGeneration = createGeneration(raceParent);
  const race = reconcileOwnedStaging([raceParent], raceGeneration.record.generation_id, {
    write: true,
    liveness: deadLiveness,
    beforeDelete({ generation }) {
      const changed = JSON.parse(fs.readFileSync(generation.recordPath, 'utf8'));
      changed.operation = 'concurrent-replacement';
      fs.writeFileSync(generation.recordPath, `${JSON.stringify(changed, null, 2)}\n`);
    }
  });
  assert.equal(race.reconciled, false);
  assert.equal(race.reason, 'ownership-record-changed');
  assert.equal(fs.existsSync(raceGeneration.stagePath), true);
});

test('one current generation cleanup cannot remove another concurrent generation', () => {
  const parent = fixtureRoot('concurrent');
  const generationA = createGeneration(parent, 'current-a');
  const generationB = createGeneration(parent, 'current-b');
  markOwnedStaging(generationA, 'failed');
  const cleanupA = cleanupOwnedGeneration(generationA, { currentOperation: true });
  assert.equal(cleanupA.cleaned, true);
  assert.equal(fs.existsSync(generationA.stagePath), false);
  assert.equal(fs.existsSync(generationB.stagePath), true);
  assert.equal(fs.existsSync(generationB.recordPath), true);
});

test('historical unmarked, unrelated matching, and malformed entries are reported and preserved byte-for-byte', () => {
  const parent = fixtureRoot('historical');
  const historical = path.join(parent, '.staging-legacy');
  const unrelated = path.join(parent, '.user-skill.staging-custom');
  fs.mkdirSync(historical);
  fs.mkdirSync(unrelated);
  fs.writeFileSync(path.join(historical, 'manifest.json'), '{"legacy":"unchanged"}\n');
  fs.writeFileSync(path.join(unrelated, 'user.txt'), 'unchanged user bytes\n');
  const malformedId = '11111111-1111-4111-8111-111111111111';
  const malformed = path.join(parent, `${RECORD_PREFIX}${malformedId}.json`);
  fs.writeFileSync(malformed, '{ malformed private-value-do-not-print');
  const beforeHistorical = fs.readFileSync(path.join(historical, 'manifest.json'));
  const beforeUnrelated = fs.readFileSync(path.join(unrelated, 'user.txt'));

  const audit = auditOwnedStaging([parent], { liveness: deadLiveness });
  assert.equal(audit.counts['historical-unmarked'], 1);
  assert.equal(audit.counts['unrelated-matching'], 1);
  assert.equal(audit.counts.malformed, 1);
  assert.doesNotMatch(JSON.stringify(audit), /private-value-do-not-print/);
  assert.deepEqual(fs.readFileSync(path.join(historical, 'manifest.json')), beforeHistorical);
  assert.deepEqual(fs.readFileSync(path.join(unrelated, 'user.txt')), beforeUnrelated);
  assert.equal(fs.existsSync(malformed), true);
});

test('path escapes and special staging objects are rejected without traversal or deletion', (t) => {
  const escapeParent = fixtureRoot('escape');
  const escaped = createGeneration(escapeParent);
  const escapedRecord = JSON.parse(fs.readFileSync(escaped.recordPath, 'utf8'));
  escapedRecord.expected_staging_path = path.join(path.dirname(escapeParent), 'outside-staging');
  fs.writeFileSync(escaped.recordPath, `${JSON.stringify(escapedRecord, null, 2)}\n`);
  const escapeInspection = inspectOwnedGeneration(escaped.recordPath, { expectedParent: escapeParent, liveness: deadLiveness });
  assert.equal(escapeInspection.classification, 'ownership-mismatched');
  assert.match(escapeInspection.reason, /staging-parent-mismatch|staging-path-escape/);

  const specialParent = fixtureRoot('special');
  const special = createGeneration(specialParent);
  const external = path.join(fixtureRoot('external'), 'external-target');
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, 'must-remain.txt'), 'do not traverse or delete\n');
  fs.rmSync(special.stagePath, { recursive: true });
  try {
    fs.symlinkSync(external, special.stagePath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`special filesystem fixture unavailable: ${error.code || error.message}`);
    return;
  }
  const specialAudit = auditOwnedStaging([specialParent], { liveness: deadLiveness });
  assert.equal(specialAudit.entries[0].classification, 'special-filesystem-object');
  const refused = reconcileOwnedStaging([specialParent], special.record.generation_id, { write: true, liveness: deadLiveness });
  assert.equal(refused.reconciled, false);
  assert.equal(fs.readFileSync(path.join(external, 'must-remain.txt'), 'utf8'), 'do not traverse or delete\n');
  assert.equal(fs.lstatSync(special.stagePath).isSymbolicLink(), true);
});

test('audit diagnostics are bounded and never enumerate staging payload contents', () => {
  const parent = fixtureRoot('bounded');
  for (let index = 0; index < 5; index += 1) {
    const generation = createGeneration(parent, `current-${index}`);
    fs.writeFileSync(path.join(generation.stagePath, `secret-${index}.txt`), `customer-secret-${index}\n`);
  }
  const audit = auditOwnedStaging([parent], { liveness: deadLiveness, limit: 3 });
  assert.equal(audit.entries.length, 3);
  assert.equal(audit.truncated, true);
  assert.doesNotMatch(JSON.stringify(audit), /customer-secret|secret-\d+\.txt/);
});
