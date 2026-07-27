#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TARGETS = [
  ['.github/workflows/auto-sync-generated-surfaces.yml', 'CAPTURE_NODE_TOOLCHAIN_SHA256', 'repo/scripts/trusted-workflows/capture-node-toolchain.cjs'],
  ['.github/workflows/auto-sync-generated-surfaces.yml', 'VERIFY_CLOSURE_MANIFEST_SHA256', 'repo/scripts/trusted-workflows/verify-closure-manifest.cjs'],
  ['.github/workflows/source-watch-pr.yml', 'CAPTURE_NODE_TOOLCHAIN_SHA256', 'repo/scripts/trusted-workflows/capture-node-toolchain.cjs'],
  ['.github/workflows/source-watch-pr.yml', 'VERIFY_CLOSURE_MANIFEST_SHA256', 'repo/scripts/trusted-workflows/verify-closure-manifest.cjs']
];

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const mode = process.argv[2];
  if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) throw new Error('TW_BOOTSTRAP_ARGUMENTS');
  const grouped = new Map();
  for (const [workflow, name, helper] of TARGETS) {
    if (!grouped.has(workflow)) grouped.set(workflow, []);
    grouped.get(workflow).push([name, sha(path.join(REPO_ROOT, helper))]);
  }
  for (const [workflow, values] of grouped) {
    const absolute = path.join(REPO_ROOT, workflow);
    const original = fs.readFileSync(absolute, 'utf8');
    YAML.parse(original);
    let updated = original;
    for (const [name, digest] of values) {
      const expression = new RegExp('^(\\s*' + name + ':\\s*)[0-9a-f]{64}\\s*$', 'm');
      if (!expression.test(updated)) throw new Error('TW_BOOTSTRAP_FIELD_MISSING:' + workflow + ':' + name);
      updated = updated.replace(expression, '$1' + digest);
    }
    if (mode === '--write') fs.writeFileSync(absolute, updated, 'utf8');
    else if (updated !== original) throw new Error('TW_BOOTSTRAP_STALE:' + workflow);
  }
}

main();
