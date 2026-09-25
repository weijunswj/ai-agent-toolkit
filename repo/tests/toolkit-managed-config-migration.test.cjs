'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../scripts/toolkit-managed-config-migration.cjs');
const fs = require('node:fs');
const path = require('node:path');

test('managed config migration removes only an exact Toolkit-owned block', () => {
  const text = 'user = true\n\n# AI-AGENT-TOOLKIT:BEGIN CODEX-HELPER-CAPACITY v3\nmax_concurrent_threads_per_session = 2\n# AI-AGENT-TOOLKIT:END CODEX-HELPER-CAPACITY\n\nkeep = true\n';
  let written = '';
  const preview = migration.planManagedConfigMigration({ text });
  assert.equal(preview.status, 'MIGRATION_REQUIRED');
  const result = migration.migrateManagedConfiguration({ text, write: true, atomic_write: (value) => { written = value; } });
  assert.equal(result.status, 'MIGRATED');
  assert.equal(result.policy_authority_removed, true);
  assert.match(written, /user = true/);
  assert.match(written, /keep = true/);
  assert.doesNotMatch(written, /HELPER-CAPACITY/);
  assert.equal(written, 'user = true\n\n\nkeep = true\n');
});

test('structurally ambiguous configuration is blocked without a write', () => {
  const result = migration.migrateManagedConfiguration({ text: 'helper-capacity = 1\n', write: true, atomic_write: () => { throw new Error('must not write'); } });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason_code, 'STRUCTURAL_CONFIGURATION_UNSAFE');
});

test('marker presence with altered managed values is blocked without a write', () => {
  let writes = 0;
  const result = migration.migrateManagedConfiguration({
    text: '# AI-AGENT-TOOLKIT:BEGIN CODEX-HELPER-CAPACITY v3\nuser_value = 1\n# AI-AGENT-TOOLKIT:END CODEX-HELPER-CAPACITY\n',
    write: true,
    atomic_write: () => { writes += 1; }
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(writes, 0);
});

test('failed migration invokes rollback with the exact original bytes', () => {
  const text = '# AI-AGENT-TOOLKIT:BEGIN CODEX-HELPER-CAPACITY v3\nmax_concurrent_threads_per_session = 2\n# AI-AGENT-TOOLKIT:END CODEX-HELPER-CAPACITY\n';
  let rollbackRequest;
  assert.throws(() => migration.migrateManagedConfiguration({
    text,
    write: true,
    atomic_write: () => { throw new Error('interrupted'); },
    rollback: (request) => { rollbackRequest = request; return true; }
  }), (error) => error.code === 'MIGRATION_WRITE_FAILED');
  assert.deepEqual(rollbackRequest, { original_text: text, attempted_text: '' });
});

test('exact-looking Toolkit blocks inside TOML multiline strings remain byte-for-byte user data', () => {
  for (const delimiter of ['"""', "'''"]) {
    const text = `note = ${delimiter}\n${migration.CODEX_DELEGATION_BEGIN || '# AI-AGENT-TOOLKIT:BEGIN CODEX-DELEGATION v3'}\nmax_threads = 2\nmax_depth = 1\n# AI-AGENT-TOOLKIT:END CODEX-DELEGATION\n${delimiter}\n`;
    const inspection = migration.inspectManagedConfiguration({ text });
    assert.equal(inspection.status, 'NOOP');
    assert.equal(inspection.block_count, 0);
    assert.equal(migration.migrateManagedConfiguration({ text, write: false }).changed, false);
    assert.equal(text.includes('max_threads = 2'), true);
  }
});

test('tomllib-valid escaped triple-quote user content cannot manufacture owned ranges', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'toolkit-toml', 'escaped-triple-quote-user-content.toml'), 'utf8');
  let writes = 0;
  const inspection = migration.inspectManagedConfiguration({ text });
  const result = migration.migrateManagedConfiguration({ text, write: true, atomic_write: () => { writes += 1; } });
  assert.equal(inspection.status, 'NOOP');
  assert.equal(inspection.block_count, 0);
  assert.equal(result.changed, false);
  assert.equal(writes, 0);
});
