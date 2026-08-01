'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(repoRoot, '_projects', 'design', 'google-design-md', '_main', 'design-md-contract.md');
const generatedPath = path.join(repoRoot, 'skills', 'ui-ux-secure-frontend-design', 'references', 'design-md-contract.md');
const manifestPath = path.join(repoRoot, '_projects', 'design', 'google-design-md', 'toolkit.project.json');
const sourceLockPath = path.join(repoRoot, '_projects', 'design', 'google-design-md', 'SOURCE-LOCK.json');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function stripGeneratedNotices(text) {
  let remaining = text.trimStart();
  while (remaining.startsWith('<!--')) {
    const end = remaining.indexOf('-->');
    assert.notEqual(end, -1, 'generated notice close marker');
    remaining = remaining.slice(end + '-->'.length).trimStart();
  }
  return `${remaining.trimEnd()}\n`;
}

test('Google DESIGN reference preserves omitted declaration semantics and reviewed provenance', () => {
  const source = readText(sourcePath);
  const generated = readText(generatedPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const sourceLock = JSON.parse(fs.readFileSync(sourceLockPath, 'utf8'));
  const output = manifest.outputs.find((entry) => entry.output === 'skills/ui-ux-secure-frontend-design/references/design-md-contract.md');
  const contractEntries = sourceLock.files.filter((entry) => entry.source_path === 'docs/spec.md');

  assert.equal(stripGeneratedNotices(generated), source, 'generated reference is an exact source copy after its notice');
  assert.match(source, /omitted: <string\[\]\|OmittedSection\[\]> # optional/);
  assert.match(source, /string naming the omitted section/);
  assert.match(source, /\{ section: string, reason\?: string \}/);
  assert.match(source, /The `reason` field is optional/);
  assert.match(source, /does not add or run the upstream linter/);

  assert.equal(manifest.version, '1.1.0');
  assert.equal(output?.kind, 'copy');
  assert.equal(output?.source, '_main/design-md-contract.md');
  assert.equal(output?.fidelity, 'exact');
  assert.equal(sourceLock.source_repo, 'google-labs-code/design.md');
  assert.equal(sourceLock.source_ref, 'main');
  assert.equal(sourceLock.source_commit, '9bf8eae67128b6cc55ad9bf86665767deb4c11cd');
  assert.deepEqual(contractEntries.map((entry) => entry.source_blob_sha), [
    '5995e5482fc338a9f9923d5912551241a82e6e8a',
    '5995e5482fc338a9f9923d5912551241a82e6e8a'
  ]);
});
