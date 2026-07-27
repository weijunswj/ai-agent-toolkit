#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'side-effect-manifest.json'), 'utf8'));
const child = path.join(__dirname, 'side-effect-child.cjs');
const job = process.argv[2];
if (!['ubuntu-node22', 'ubuntu-node24', 'macos-node24', 'host-applicable'].includes(job) || process.argv.length !== 3) {
  throw new Error('SIDE_EFFECT_DRIVER_ARGUMENTS');
}
const hostOs = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : 'other';
const hostMajor = Number(process.versions.node.split('.')[0]);
let executed = 0;
let absent = 0;

for (const entry of manifest.entries) {
  const applicable = entry.platform_constraints.applicable_os.includes(hostOs) && hostMajor >= entry.minimum_node_version;
  const selected = job === 'host-applicable' ? applicable : entry.platform_constraints.execution_jobs.includes(job);
  if (selected && !applicable) throw new Error('SIDE_EFFECT_JOB_PLATFORM_MISMATCH:' + entry.variant_id);
  if (!selected) {
    if (entry.platform_constraints.absence_jobs.includes(job)) {
      const value = entry.export_path.split('.').reduce((current, component) => current && current[component], require(entry.module));
      assert.equal(typeof value, 'undefined', entry.variant_id + ' unexpectedly exists on an unsupported runtime');
      absent += 1;
    }
    continue;
  }
  const encoded = Buffer.from(JSON.stringify(entry)).toString('base64url');
  const result = spawnSync(process.execPath, [child, encoded], {
    cwd: path.resolve(__dirname, '..', '..', '..', '..'),
    encoding: 'utf8',
    timeout: entry.timeout_ms,
    windowsHide: true,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    maxBuffer: 1024 * 1024
  });
  assert.equal(result.status, 0, entry.variant_id + ' child exit');
  assert.equal(result.signal, null, entry.variant_id + ' child signal');
  assert.equal(result.stderr, '', entry.variant_id + ' stderr');
  assert.match(result.stdout, /^\{[^\r\n]*\}\n$/, entry.variant_id + ' stdout grammar');
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(parsed).sort(), ['cleanup_complete', 'guard_blocked', 'sentinel_calls', 'variant_id']);
  assert.equal(parsed.variant_id, entry.variant_id);
  assert.equal(parsed.guard_blocked, true);
  assert.equal(parsed.sentinel_calls, 0);
  assert.equal(parsed.cleanup_complete, true);
  executed += 1;
}
process.stdout.write(JSON.stringify({ protocol_version: 1, job, executed, absence_proofs: absent, manifest_entries: manifest.entries.length }) + '\n');
