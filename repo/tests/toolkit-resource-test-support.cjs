'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require.main === module ? null : require('node:test');
const { types: utilTypes } = require('node:util');
const { spawn } = require('node:child_process');
const control = require('../scripts/toolkit-agent-control.cjs');

const INVOCATION = Object.freeze({
  invocation: 'toolkit.repository-test.resource.v1',
  fixture_id: 'healthy-resource-v1',
});
const FIXTURE = Object.freeze({
  source: 'repository-test-fixture',
  fixture_id: 'healthy-resource-v1',
  physical_total: 17179869184,
  physical_available: 8589934592,
  commit_total: 34359738368,
  commit_available: 17179869184,
  host_responsive: true,
});
const OWNED_ROOTS = new Set();

function isFixture(value) {
  if (!value || typeof value !== 'object') return false;
  try { if (utilTypes.isProxy(value)) return false; } catch (_) { return false; }
  if (Array.isArray(value)) return false;
  let prototype;
  let names;
  try {
    prototype = Object.getPrototypeOf(value);
    names = Object.getOwnPropertyNames(value);
    if (Object.getOwnPropertySymbols(value).length > 0) return false;
  } catch (_) { return false; }
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = names.sort();
  const expected = Object.keys(FIXTURE).sort();
  if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index])) return false;
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || descriptor.value !== FIXTURE[key]) return false;
  }
  return true;
}

function registerOwnedRoot(root) {
  const target = path.resolve(String(root || ''));
  const tempRoot = path.resolve(os.tmpdir());
  if (path.dirname(target) !== tempRoot || !/^toolkit-agent-control-/.test(path.basename(target))) {
    throw new Error('Repository-test support requires its own bounded Toolkit temporary root.');
  }
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Repository-test support root must be a real directory.');
  OWNED_ROOTS.add(target);
  return target;
}

function withFixture(root, callback) {
  const target = registerOwnedRoot(root);
  return control.withRepositoryTestResourceInvocation(INVOCATION, target, callback);
}

function runAdmissionChild(spec, root, claudeCli) {
  const target = registerOwnedRoot(root);
  const input = JSON.stringify({ spec, root: target, claude_cli: claudeCli });
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.NODE_PATH;
    const child = spawn(process.execPath, [__filename, 'admission'], {
      cwd: path.resolve(__dirname, '..', '..'),
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `repository-test runner exited ${code}`));
      try { resolve(JSON.parse(stdout)); } catch (_) {
        reject(new Error(`repository-test runner emitted invalid JSON; stdout=${stdout.slice(0, 400)}; stderr=${stderr.slice(0, 400)}`));
      }
    });
    child.stdin.end(input);
  });
}

function options(root, extra = {}) {
  return { ...extra, root, repository_test_invocation: INVOCATION, resourceState: FIXTURE };
}

if (test) {
  test.after(() => {
    for (const root of OWNED_ROOTS) {
      try {
        const stat = fs.lstatSync(root);
        if (stat.isDirectory() && !stat.isSymbolicLink()) fs.rmSync(root, { recursive: true, force: false });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  });
}

module.exports = Object.freeze({ INVOCATION, FIXTURE, isFixture, withFixture, options, registerOwnedRoot, runAdmissionChild });

if (require.main === module) {
  const chunks = [];
  let bytes = 0;
  process.stdin.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error('repository-test input exceeds its bound');
    chunks.push(chunk);
  });
  process.stdin.on('end', () => {
    try {
      if (process.argv[2] !== 'admission') throw new Error('unsupported repository-test operation');
      const input = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
      if (!input || Object.keys(input).sort().join('\u0000') !== 'claude_cli\u0000root\u0000spec'
        || typeof input.root !== 'string' || typeof input.claude_cli !== 'string') throw new Error('repository-test input is invalid');
      const result = control.withRepositoryTestResourceInvocation(INVOCATION, input.root, () => control.admissionDecision(
        input.spec,
        { root: input.root, claudeCli: input.claude_cli, repository_test_invocation: INVOCATION, resourceState: FIXTURE },
      ));
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  });
}
