'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const generatedPath = path.join(repoRoot, 'skills', 'ui-ux-secure-frontend-design', 'references', 'design-md-contract.md');
const sourceLockPath = path.join(repoRoot, 'repo', 'source-watch', 'provenance', 'google-design-md', 'SOURCE-LOCK.json');

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
  const generated = readText(generatedPath);
  const sourceLock = JSON.parse(fs.readFileSync(sourceLockPath, 'utf8'));
  const contractEntries = sourceLock.files.filter((entry) => entry.source_path === 'docs/spec.md');
  const reference = stripGeneratedNotices(generated);

  assert.match(reference, /omitted: <string\[\]\|OmittedSection\[\]> # optional/);
  assert.match(reference, /string naming the omitted section/);
  assert.match(reference, /\{ section: string, reason\?: string \}/);
  assert.match(reference, /The `reason` field is optional/);
  assert.match(reference, /does not add or run the upstream linter/);

  assert.equal(sourceLock.source_repo, 'google-labs-code/design.md');
  assert.equal(sourceLock.source_ref, 'main');
  assert.equal(sourceLock.source_commit, '9bf8eae67128b6cc55ad9bf86665767deb4c11cd');
  assert.deepEqual(contractEntries.map((entry) => entry.source_blob_sha), [
    '5995e5482fc338a9f9923d5912551241a82e6e8a',
    '5995e5482fc338a9f9923d5912551241a82e6e8a'
  ]);
  assert.deepEqual(contractEntries.map((entry) => entry.root_surface_path), [
    'skills/ui-ux-secure-frontend-design/references/design-md-contract.md',
    'skills/ui-ux-secure-frontend-design/references/design-md-contract.md'
  ]);
});
