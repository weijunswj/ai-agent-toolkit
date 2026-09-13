'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../scripts/toolkit-managed-config-migration.cjs');

test('managed config migration removes only an exact Toolkit-owned block', () => {
  const text = 'user = true\n\n# AI-AGENT-TOOLKIT:BEGIN CODEX-HELPER-CAPACITY v3\nmax = 1\n# AI-AGENT-TOOLKIT:END CODEX-HELPER-CAPACITY\n\nkeep = true\n';
  let written = '';
  const preview = migration.planManagedConfigMigration({ text });
  assert.equal(preview.status, 'MIGRATION_REQUIRED');
  const result = migration.migrateManagedConfiguration({ text, write: true, atomic_write: (value) => { written = value; } });
  assert.equal(result.status, 'MIGRATED');
  assert.equal(result.policy_authority_removed, true);
  assert.match(written, /user = true/);
  assert.match(written, /keep = true/);
  assert.doesNotMatch(written, /HELPER-CAPACITY/);
});

test('structurally ambiguous configuration is blocked without a write', () => {
  const result = migration.migrateManagedConfiguration({ text: 'helper-capacity = 1\n', write: true, atomic_write: () => { throw new Error('must not write'); } });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason_code, 'STRUCTURAL_CONFIGURATION_UNSAFE');
});
