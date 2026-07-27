'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const manifestPath = path.join(__dirname, 'fixtures', 'trusted-workflows', 'locked-named-tests.json');

test('standalone locked named-test manifest is exact, complete and current', function() {
  const result = spawnSync(process.execPath, ['repo/scripts/build-locked-test-manifest.cjs', '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.design_lock, 'DL-299-310-003');
  assert.ok(manifest.tests.length >= 120);
  assert.equal(new Set(manifest.tests.map((entry) => entry.test_id)).size, manifest.tests.length);
  assert.equal(new Set(manifest.tests.map((entry) => entry.file + '\0' + entry.name)).size, manifest.tests.length);
  assert.deepEqual([...new Set(manifest.tests.map((entry) => entry.file))], manifest.scope_files);
});
