'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const generatedPath = path.join(repoRoot, 'skills', 'frontend-art-direction', 'references', 'design-md-contract.md');
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

  assert.match(reference, /interleaved fenced `yaml` code blocks/);
  assert.match(reference, /merge into one design token tree/);
  assert.match(reference, /same top-level key in more than one block is an error/);
  assert.match(reference, /motion:\n  <token-name>: <Motion>/);
  assert.match(reference, /`duration`[^\n]*`delay`[^\n]*`timingFunction`/);
  assert.match(reference, /Duration[^\n]*`ms`/);
  assert.match(reference, /Unknown motion token names are valid motion/);
  const sectionOrder = [
    'Overview', 'Colors', 'Typography', 'Layout', 'Elevation & Depth', 'Shapes',
    'Motion & Micro-interaction', 'Voice & Content Strategy', 'Components', "Do's and Don'ts"
  ];
  sectionOrder.forEach((name, index) => {
    assert.ok(reference.includes(`${index + 1}. **${name}**`), `section order ${index + 1}: ${name}`);
  });
  assert.match(reference, /prefers-reduced-motion/);

  assert.equal(sourceLock.source_repo, 'google-labs-code/design.md');
  assert.equal(sourceLock.source_ref, 'main');
  assert.equal(sourceLock.source_commit, '679d3018869335b8ef7906b69fccfd4d48991d1b');
  assert.deepEqual(contractEntries.map((entry) => entry.source_blob_sha), [
    'fc04f91a561fbde6be804c9d33defc285b09a976'
  ]);
  assert.deepEqual(contractEntries.map((entry) => entry.root_surface_path), [
    'skills/frontend-art-direction/references/design-md-contract.md'
  ]);
});
