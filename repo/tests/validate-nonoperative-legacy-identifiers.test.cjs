'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const validator = require('../scripts/validate-nonoperative-legacy-identifiers.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const allowlistPath = path.join(repoRoot, ...validator.ALLOWLIST_REL_PATH.split('/'));

function writeFile(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function token(...parts) {
  return parts.join('-');
}

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-identifier-validator-'));
  writeFile(path.join(root, validator.ALLOWLIST_REL_PATH), fs.readFileSync(allowlistPath));
  execFileSync('git', ['-C', root, 'init', '--quiet']);
  return root;
}

function track(root, ...files) {
  execFileSync('git', ['-C', root, 'add', '--', ...files]);
}

test('canonical tracked tree satisfies the exact retirement allowlist', () => {
  const result = validator.validateTrackedTree(repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.findings));
});

test('unknown and active route contexts fail without broad fixture exemptions', () => {
  const root = fixtureRoot();
  const legacy = token('toolkit', 'agent', 'control');
  const active = token('worker', 'route');
  writeFile(path.join(root, 'repo', 'fixture', 'unknown.js'), `const value = '${legacy}';\n`);
  writeFile(path.join(root, 'repo', 'fixture', 'active.js'), `const route = '${active}';\n`);
  track(root, 'repo/fixture/unknown.js', 'repo/fixture/active.js', validator.ALLOWLIST_REL_PATH);
  const result = validator.validateTrackedTree(root);
  assert.equal(result.ok, false);
  assert.equal(result.findings.filter((finding) => finding.code === 'LEGACY_IDENTIFIER_UNCLASSIFIED').length, 2);
  assert.deepEqual(result.findings.map((finding) => finding.path).sort(), ['repo/fixture/active.js', 'repo/fixture/unknown.js']);
});

test('historical-looking markers cannot exempt executable retired identifiers', () => {
  const root = fixtureRoot();
  const target = path.join(root, 'repo', 'scripts', 'setup-toolkit-core.cjs');
  writeFile(target, [
    '// NONOPERATIVE-LEGACY-CONTEXT: historical',
    'const reservation = false;',
    '// NONOPERATIVE-LEGACY-CONTEXT:END',
    ''
  ].join('\n'));
  track(root, 'repo/scripts/setup-toolkit-core.cjs', validator.ALLOWLIST_REL_PATH);
  const result = validator.validateTrackedTree(root);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'LEGACY_IDENTIFIER_UNCLASSIFIED'));
});

test('an exact migration field on its exact path remains narrowly classified', () => {
  const root = fixtureRoot();
  writeFile(path.join(root, 'repo', 'scripts', 'setup-toolkit-core.cjs'), 'const state = { reservation_queue_policy: false };\n');
  track(root, 'repo/scripts/setup-toolkit-core.cjs', validator.ALLOWLIST_REL_PATH);
  const result = validator.validateTrackedTree(root);
  assert.equal(result.ok, true, JSON.stringify(result.findings));
});
