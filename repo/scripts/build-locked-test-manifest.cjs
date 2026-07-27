#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const output = path.join(repoRoot, 'repo', 'tests', 'fixtures', 'trusted-workflows', 'locked-named-tests.json');
const scopeFiles = [
  'repo/tests/closure-manifest.test.cjs',
  'repo/tests/existing-base-autosync-proof.test.cjs',
  'repo/tests/issue-governance-generated-parity.test.cjs',
  'repo/tests/issue-governance-side-effects.test.cjs',
  'repo/tests/issue-governance.test.cjs',
  'repo/tests/locked-test-manifest.test.cjs',
  'repo/tests/setup-node-identity.test.cjs',
  'repo/tests/source-watch-pr-workflow.test.cjs',
  'repo/tests/trusted-workflow-rollout.test.cjs',
  'repo/tests/workflow-inventory.test.cjs'
];

function build() {
  const tests = [];
  for (const relative of scopeFiles) {
    const source = fs.readFileSync(path.join(repoRoot, ...relative.split('/')), 'utf8');
    const expression = /^test\('([^'\r\n]+)'/gm;
    let match;
    while ((match = expression.exec(source))) {
      tests.push({
        test_id: 'LOCKED-' + String(tests.length + 1).padStart(3, '0'),
        file: relative,
        name: match[1]
      });
    }
  }
  if (!tests.length || new Set(tests.map((entry) => entry.file + '\0' + entry.name)).size !== tests.length) {
    throw new Error('LOCKED_TEST_MANIFEST_DUPLICATE_OR_EMPTY');
  }
  return {
    schema_version: 1,
    design_lock: 'DL-299-310-003',
    scope_files: scopeFiles,
    tests
  };
}

function main() {
  const mode = process.argv[2];
  if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) {
    throw new Error('LOCKED_TEST_MANIFEST_ARGUMENTS');
  }
  const expected = JSON.stringify(build(), null, 2) + '\n';
  if (mode === '--write') {
    fs.writeFileSync(output, expected, 'utf8');
  } else {
    const actual = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
    if (actual !== expected) throw new Error('LOCKED_TEST_MANIFEST_STALE');
  }
}

if (require.main === module) main();
module.exports = { build };
