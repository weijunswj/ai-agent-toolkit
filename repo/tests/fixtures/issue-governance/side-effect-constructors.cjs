#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const manifestPath = path.join(__dirname, 'side-effect-manifest.json');
const exportSpecs = [
  ['node:fs', 'writeFileSync', 'sync', 'fs-write'], ['node:fs', 'appendFileSync', 'sync', 'fs-append'],
  ['node:fs', 'mkdirSync', 'sync', 'fs-mkdir'], ['node:fs', 'rmSync', 'sync', 'fs-rm'],
  ['node:fs', 'unlinkSync', 'sync', 'fs-unlink'], ['node:fs', 'renameSync', 'sync', 'fs-rename'],
  ['node:fs', 'copyFileSync', 'sync', 'fs-copy'], ['node:fs', 'truncateSync', 'sync', 'fs-truncate'],
  ['node:fs', 'chmodSync', 'sync', 'fs-chmod'], ['node:fs', 'chownSync', 'sync', 'fs-chown'],
  ['node:fs', 'utimesSync', 'sync', 'fs-utimes'], ['node:fs', 'symlinkSync', 'sync', 'fs-symlink'],
  ['node:fs', 'lchmodSync', 'sync', 'fs-lchmod'], ['node:fs', 'openSync', 'sync', 'fs-open-wx'],
  ['node:fs', 'writeFile', 'callback', 'fs-write'], ['node:fs', 'appendFile', 'callback', 'fs-append'],
  ['node:fs', 'mkdir', 'callback', 'fs-mkdir'], ['node:fs', 'rm', 'callback', 'fs-rm'],
  ['node:fs', 'unlink', 'callback', 'fs-unlink'], ['node:fs', 'rename', 'callback', 'fs-rename'],
  ['node:fs', 'copyFile', 'callback', 'fs-copy'], ['node:fs', 'truncate', 'callback', 'fs-truncate'],
  ['node:fs', 'chmod', 'callback', 'fs-chmod'], ['node:fs', 'chown', 'callback', 'fs-chown'],
  ['node:fs', 'utimes', 'callback', 'fs-utimes'], ['node:fs', 'symlink', 'callback', 'fs-symlink'],
  ['node:fs', 'lchmod', 'callback', 'fs-lchmod'], ['node:fs', 'open', 'callback', 'fs-open-wx'],
  ['node:fs', 'promises.writeFile', 'promise', 'fs-write'], ['node:fs', 'promises.appendFile', 'promise', 'fs-append'],
  ['node:fs', 'promises.mkdir', 'promise', 'fs-mkdir'], ['node:fs', 'promises.rm', 'promise', 'fs-rm'],
  ['node:fs', 'promises.unlink', 'promise', 'fs-unlink'], ['node:fs', 'promises.rename', 'promise', 'fs-rename'],
  ['node:fs', 'promises.copyFile', 'promise', 'fs-copy'], ['node:fs', 'promises.truncate', 'promise', 'fs-truncate'],
  ['node:fs', 'promises.chmod', 'promise', 'fs-chmod'], ['node:fs', 'promises.chown', 'promise', 'fs-chown'],
  ['node:fs', 'promises.utimes', 'promise', 'fs-utimes'], ['node:fs', 'promises.symlink', 'promise', 'fs-symlink'],
  ['node:fs', 'promises.link', 'promise', 'fs-link'], ['node:fs', 'promises.open', 'promise', 'fs-open-wx'],
  ['node:dns', 'lookup', 'callback', 'dns-localhost'], ['node:dns', 'resolve4', 'callback', 'dns-localhost'],
  ['node:dns', 'promises.lookup', 'promise', 'dns-localhost'],
  ['node:child_process', 'spawnSync', 'sync', 'child-node'],
  ['node:worker_threads', 'Worker', 'promise', 'worker-eval']
];
const referenceModes = ['cjs-module-object-after', 'node-module-object-after', 'cjs-destructured-after', 'node-destructured-after'];

function entry(spec, referenceMode, index) {
  const [moduleName, exportPath, form, constructor] = spec;
  const lchmod = exportPath.toLowerCase().includes('lchmod');
  return {
    variant_id: 'SE' + String(index + 1).padStart(3, '0') + '-' + moduleName.slice(5).replace(/_/g, '-') + '-' + exportPath.replace(/\./g, '-') + '-' + referenceMode,
    module: moduleName,
    export_path: exportPath,
    reference_acquisition: referenceMode,
    form,
    argument_constructor: constructor,
    positive_control_procedure: 'Execute the exact export against a disposable local sentinel and require one observed effect.',
    guarded_call_procedure: 'Install the interceptor before acquiring the tested reference, invoke the exact export, and require the typed guard error.',
    expected_guarded_error: { code: 'SIDE_EFFECT_GUARD_BLOCKED', message_prefix: 'SIDE_EFFECT_GUARD_BLOCKED:' },
    observable_sentinel: 'child-owned disposable path or process-local callback counter',
    cleanup_procedure: 'Remove the child-owned disposable directory and prove it is absent before reporting.',
    timeout_ms: 5000,
    minimum_node_version: lchmod ? 24 : 22,
    platform_constraints: {
      applicable_os: lchmod ? ['darwin'] : ['linux', 'darwin'],
      execution_jobs: lchmod ? ['macos-node24'] : ['ubuntu-node22', 'ubuntu-node24'],
      absence_jobs: lchmod ? ['ubuntu-node22', 'ubuntu-node24'] : []
    },
    stdout_policy: 'exactly one strict JSON object followed by LF',
    stderr_policy: 'empty; experimental warnings are forbidden'
  };
}

const entries = [];
for (const spec of exportSpecs) {
  for (const referenceMode of referenceModes) entries.push(entry(spec, referenceMode, entries.length));
}
if (entries.length !== 188) throw new Error('SIDE_EFFECT_MANIFEST_CARDINALITY:' + entries.length);
const manifest = { schema_version: 1, entry_count: entries.length, entries };
const expected = JSON.stringify(manifest, null, 2) + '\n';
const mode = process.argv[2];
if (mode === '--write') fs.writeFileSync(manifestPath, expected, 'utf8');
else if (mode === '--check') {
  if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== expected) throw new Error('SIDE_EFFECT_MANIFEST_STALE');
} else throw new Error('SIDE_EFFECT_MANIFEST_ARGUMENTS');
