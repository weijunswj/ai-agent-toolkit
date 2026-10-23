'use strict';

// update-source-watch-review-branch.sh: report-only branch shapes, commit ancestry and tree shapes
// that must never qualify for a no-op. Split from update-source-watch-review-branch.test.cjs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  reportPath,
  writeFile,
  makeFixture,
  createRemoteReportBranch,
  createRootCommitBranch,
  createUnrelatedParentBranch,
  createMergeBranch,
  createMissingBlobBranch,
  createSubmoduleBranch,
  createRenameBranch,
  createSymlinkBranch,
  runHelper,
} = require('./update-source-watch-test-support.cjs');

test('invalid report-only shapes take the rebuild path instead of no-op', (t) => {
  const cases = [
    {
      name: 'extra path',
      mutate(source) { writeFile(path.join(source, 'unexpected.txt'), 'unexpected\n'); }
    },
    {
      name: 'executable report',
      mutate(source) { fs.chmodSync(path.join(source, reportPath), 0o755); },
      options: { executable: true }
    },
    {
      name: 'missing report',
      mutate(source) { fs.rmSync(path.join(source, reportPath)); },
      options: { emptyCommit: true }
    }
  ];
  for (const item of cases) {
    const fixture = makeFixture(t, `shape-${item.name}\n`);
    createRemoteReportBranch(fixture, fixture.reportText, item.mutate, item.options);
    const result = runHelper(fixture);
    assert.equal(result.status, 0, `${item.name}: ${result.stderr || result.error}`);
    assert.doesNotMatch(result.output, /pushed=false/, item.name);
  }
});

test('untrusted commit ancestry and tree shapes never qualify for a no-op', (t) => {
  const cases = [
    ['root commit', createRootCommitBranch],
    ['merge commit', createMergeBranch],
    ['unrelated parent', createUnrelatedParentBranch],
    ['rename', createRenameBranch],
    ['missing blob', createMissingBlobBranch],
    ['submodule entry', createSubmoduleBranch]
  ];
  for (const [name, createBranch] of cases) {
    const fixture = makeFixture(t, `shape-${name}\n`);
    createBranch(fixture);
    const result = runHelper(fixture);
    assert.equal(result.status, 0, `${name}: ${result.stderr || result.error}`);
    assert.doesNotMatch(result.output, /pushed=false/, name);
  }
});

test('symlink report entries never qualify for a no-op when the platform permits symlinks', (t) => {
  const fixture = makeFixture(t, 'shape-symlink\n');
  if (createSymlinkBranch(fixture) === null) {
    t.skip('symlink creation is not available in this environment');
    return;
  }
  const result = runHelper(fixture);
  assert.equal(result.status, 0, result.stderr || result.error);
  assert.doesNotMatch(result.output, /pushed=false/);
});
