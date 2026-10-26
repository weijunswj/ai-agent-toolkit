'use strict';

// update-source-watch-review-branch.sh: branch shapes that are refused. The repository forbids
// force-pushes, so a branch that is not a line of report-only commits after trusted main is never
// overwritten: the helper exits non-zero and pushes nothing. Split from
// update-source-watch-review-branch.test.cjs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  reportPath,
  git,
  writeFile,
  makeFixture,
  remoteRef,
  remoteMain,
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

function assertRefused(fixture, result, before, name) {
  assert.notEqual(result.status, 0, `${name}: ${result.stdout}\n${result.stderr}`);
  assert.equal(remoteRef(fixture), before, `${name}: remote branch unchanged`);
  assert.doesNotMatch(result.output, /pushed=/, name);
}

test('invalid report-only shapes are refused without a push', (t) => {
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
    },
    {
      name: 'later commit touching another path',
      options: {
        extraCommit(source) {
          writeFile(path.join(source, 'later.txt'), 'later\n');
          git(source, ['add', 'later.txt']);
          git(source, ['commit', '-m', 'Add a non-report file']);
        }
      }
    }
  ];
  for (const item of cases) {
    // Every case uses a report that differs from the branch, so only a refusal stops a push.
    const fixture = makeFixture(t, `generated-${item.name}\n`);
    const before = createRemoteReportBranch(fixture, `shape-${item.name}\n`, item.mutate, item.options);
    assertRefused(fixture, runHelper(fixture), before, item.name);
  }
});

test('untrusted commit ancestry and tree shapes are refused without a push', (t) => {
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
    const before = createBranch(fixture);
    assertRefused(fixture, runHelper(fixture), before, name);
  }
});

test('a branch with no report commit after trusted main is refused', (t) => {
  const fixture = makeFixture(t);
  git(fixture.work, ['push', 'origin', `main:refs/heads/source-watch/review-active-third-party-updates`]);
  assertRefused(fixture, runHelper(fixture), remoteMain(fixture), 'branch at main');
});

test('trusted main that already contains the report path is refused', (t) => {
  const fixture = makeFixture(t, 'new report\n');
  const before = createRemoteReportBranch(fixture, 'old report\n');
  writeFile(path.join(fixture.work, reportPath), 'report merged into main\n');
  git(fixture.work, ['switch', 'main']);
  git(fixture.work, ['add', reportPath]);
  git(fixture.work, ['commit', '-m', 'Merge the report into trusted main']);
  git(fixture.work, ['push', 'origin', 'main']);
  git(fixture.work, ['fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
  assertRefused(fixture, runHelper(fixture), before, 'main has report');
});

test('symlink report entries are refused when the platform permits symlinks', (t) => {
  const fixture = makeFixture(t, 'shape-symlink\n');
  const before = createSymlinkBranch(fixture);
  if (before === null) {
    t.skip('symlink creation is not available in this environment');
    return;
  }
  assertRefused(fixture, runHelper(fixture), before, 'symlink');
});
