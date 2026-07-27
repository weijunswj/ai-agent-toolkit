#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fail(code) {
  if (code) process.stderr.write(code + '\n');
  process.exit(2);
}

function getExport(moduleName, exportPath) {
  let value = require(moduleName);
  for (const component of exportPath.split('.')) value = value && value[component];
  return value;
}

function acquireGuardedExport(entry) {
  const moduleName = entry.reference_acquisition.startsWith('cjs-')
    ? entry.module.replace(/^node:/, '')
    : entry.module;
  const components = entry.export_path.split('.');
  let owner = require(moduleName);
  for (const component of components.slice(0, -1)) owner = owner && owner[component];
  const key = components.at(-1);
  if (!owner || typeof owner[key] !== 'function') throw new Error('SIDE_EFFECT_EXPORT_ABSENT');
  if (entry.reference_acquisition.includes('-destructured-')) return { fn: owner[key], owner: null };
  return { fn: null, owner, key };
}

function argsFor(entry, root, guarded, callback) {
  const source = path.join(root, guarded ? 'guard-source' : 'source');
  const target = path.join(root, guarded ? 'guard-target' : 'target');
  if (!guarded && !fs.existsSync(source)) fs.writeFileSync(source, 'seed');
  switch (entry.argument_constructor) {
    case 'fs-write': return [target, 'payload', callback].filter(Boolean);
    case 'fs-append': return [target, 'payload', callback].filter(Boolean);
    case 'fs-mkdir': return [target, callback].filter(Boolean);
    case 'fs-rm':
    case 'fs-unlink': if (!guarded) fs.writeFileSync(target, 'seed'); return [target, callback].filter(Boolean);
    case 'fs-rename': return [source, target, callback].filter(Boolean);
    case 'fs-copy': return [source, target, callback].filter(Boolean);
    case 'fs-truncate': return [source, 1, callback].filter(Boolean);
    case 'fs-chmod':
    case 'fs-lchmod': return [source, 0o600, callback].filter(Boolean);
    case 'fs-chown': return [source, process.getuid(), process.getgid(), callback].filter(Boolean);
    case 'fs-utimes': return [source, new Date(0), new Date(0), callback].filter(Boolean);
    case 'fs-symlink': return [source, target, callback].filter(Boolean);
    case 'fs-link': return [source, target, callback].filter(Boolean);
    case 'fs-open-wx': return [target, 'wx', 0o600, callback].filter(Boolean);
    case 'dns-localhost': return ['localhost', callback].filter(Boolean);
    case 'child-node': return [process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' }];
    case 'worker-eval': return ['0', { eval: true }];
    default: fail();
  }
}

function invocation(entry, root, guarded, acquired) {
  const fn = acquired
    ? (acquired.fn || acquired.owner[acquired.key])
    : getExport(entry.module, entry.export_path);
  if (typeof fn !== 'function') throw new Error('SIDE_EFFECT_EXPORT_ABSENT');
  if (entry.form === 'sync') {
    const value = fn(...argsFor(entry, root, guarded));
    if (entry.argument_constructor === 'fs-open-wx' && typeof value === 'number') fs.closeSync(value);
    if (entry.argument_constructor === 'child-node' && value.status !== 0) throw new Error('SIDE_EFFECT_POSITIVE_CHILD');
    return Promise.resolve();
  }
  if (entry.argument_constructor === 'worker-eval') {
    const worker = new fn(...argsFor(entry, root, guarded));
    return new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.once('exit', (code) => code === 0 ? resolve() : reject(new Error('SIDE_EFFECT_POSITIVE_WORKER')));
    });
  }
  if (entry.form === 'promise') return fn(...argsFor(entry, root, guarded));
  return new Promise((resolve, reject) => {
    const callback = (error) => error ? reject(error) : resolve();
    fn(...argsFor(entry, root, guarded, callback));
  });
}

async function main() {
  if (process.argv.length !== 3) fail('SIDE_EFFECT_CHILD_FAILURE:arguments');
  const entry = JSON.parse(Buffer.from(process.argv[2], 'base64url').toString('utf8'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-governance-side-effect-'));
  const cleanup = fs.rmSync.bind(fs);
  let sentinelCalls = 0;
  let guardBlocked = false;
  let cleanupComplete = false;
  let phase = 'positive-control';
  try {
    await invocation(entry, root, false);
    sentinelCalls += 1;
    phase = 'guard-install';
    require('./intercept-side-effects.cjs');
    phase = 'guarded-call';
    const acquired = acquireGuardedExport(entry);
    try {
      await invocation(entry, root, true, acquired);
    } catch (error) {
      if (error && error.code === 'SIDE_EFFECT_GUARD_BLOCKED') guardBlocked = true;
      else throw error;
    }
    phase = 'cleanup';
    cleanup(root, { recursive: true, force: true });
    cleanupComplete = !fs.existsSync(root);
  } catch (error) {
    try { cleanup(root, { recursive: true, force: true }); } catch {}
    const errorCode = error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'UNCLASSIFIED';
    fail('SIDE_EFFECT_CHILD_FAILURE:' + phase + ':' + errorCode);
  }
  process.stdout.write(JSON.stringify({
    variant_id: entry.variant_id,
    guard_blocked: guardBlocked,
    sentinel_calls: guardBlocked ? sentinelCalls - 1 : sentinelCalls,
    cleanup_complete: cleanupComplete
  }) + '\n');
}

main();
