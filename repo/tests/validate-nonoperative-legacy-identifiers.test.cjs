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

test('canonical allowlist and narrow historical contexts pass', () => {
  const root = fixtureRoot();
  const legacy = token('toolkit', 'agent', 'control');
  writeFile(path.join(root, 'repo', 'docs', 'history.md'), `Legacy migration evidence: ${legacy}.\n`);
  writeFile(path.join(root, 'repo', 'docs', 'marked.md'), [
    'NONOPERATIVE-LEGACY-CONTEXT: repair-diagnostic',
    legacy,
    'NONOPERATIVE-LEGACY-CONTEXT:END',
    ''
  ].join('\n'));
  track(root, 'repo/docs/history.md', 'repo/docs/marked.md', validator.ALLOWLIST_REL_PATH);
  const result = validator.validateTrackedTree(root);
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

test('malformed context marker fails closed', () => {
  const root = fixtureRoot();
  const legacy = token('checker', 'admission');
  writeFile(path.join(root, 'repo', 'fixture', 'malformed.md'), `NONOPERATIVE-LEGACY-CONTEXT: migration-detection\n${legacy}\n`);
  track(root, 'repo/fixture/malformed.md', validator.ALLOWLIST_REL_PATH);
  const result = validator.validateTrackedTree(root);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'CONTEXT_MARKER_MALFORMED'));
  assert.ok(result.findings.some((finding) => finding.code === 'LEGACY_IDENTIFIER_UNCLASSIFIED'));
});
