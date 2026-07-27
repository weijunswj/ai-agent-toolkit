'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const helper = path.resolve(__dirname, '..', 'scripts', 'trusted-workflows', 'capture-node-toolchain.cjs');

test('setup-node capture emits one strict public identity object with empty stderr', function() {
  const result = spawnSync(process.execPath, [helper, '1'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^\{[^\r\n]*\}\n$/);
  const value = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(value).sort(), [
    'architecture', 'node_exec_path', 'node_major', 'node_realpath', 'node_sha256',
    'node_version', 'npm_exec_path', 'npm_realpath', 'npx_exec_path', 'npx_realpath',
    'path_identity_digest', 'platform', 'protocol_version', 'setup_generation'
  ]);
  for (const key of ['node_exec_path', 'node_realpath', 'node_sha256', 'npm_exec_path', 'npm_realpath', 'npx_exec_path', 'npx_realpath', 'path_identity_digest']) {
    assert.match(value[key], /^[0-9a-f]{64}$/, key);
  }
  assert.equal(result.stdout.includes(process.execPath), false);
});

test('setup-node capture generation is explicit and invalid arguments fail', function() {
  const result = spawnSync(process.execPath, [helper, '0'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'TW_CAPTURE_ARGUMENTS\n');
});
