'use strict';

// update-source-watch-review-branch.sh: fast-forward-only pushes, the final exact-ref guard, and
// races injected through a git wrapper. The repository forbids force-pushes, so every push here is
// a plain push that the remote accepts only as a new branch or a fast-forward. Report shapes and observation/push cases are in
// the -shapes and -observation files, so node --test runs the three in parallel.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  reportPath,
  git,
  gitSha,
  writeFile,
  makeFixture,
  remoteRef,
  remoteMain,
  createRemoteReportBranch,
  createCompetitorCommit,
  makeGitRaceWrapper,
  runHelper,
  assertNoOp,
} = require('./update-source-watch-test-support.cjs');

test('branch absent and stable is created from trusted main with a plain push', (t) => {
  const fixture = makeFixture(t);
  const result = runHelper(fixture);
  assert.equal(result.status, 0, result.stderr || result.error);
  assert.match(result.output, /^pushed=true$/m);
  const after = remoteRef(fixture);
  assert.ok(after);
  assert.equal(remoteMain(fixture), gitSha(fixture.work, 'refs/remotes/origin/main'));
  assert.equal(git(fixture.work, ['rev-list', '--parents', '-n', '1', after]).trim().split(/\s+/)[1], remoteMain(fixture));
});

test('branch absent with a competing unrelated creation is rejected without retry', (t) => {
  const fixture = makeFixture(t);
  const competitorSha = createCompetitorCommit(fixture, 'competitor report\n', 'absent-competitor');
  const result = runHelper(fixture, { wrapper: makeGitRaceWrapper(fixture, 'absent-competitor', competitorSha) });
  assert.notEqual(result.status, 0);
  assert.equal(remoteRef(fixture), competitorSha);
  assert.doesNotMatch(result.output, /pushed=true/);
});

test('branch absent with a competing creation at trusted main is only fast-forwarded', (t) => {
  // The competitor's commit is an ancestor of the new report commit, so the plain push keeps it
  // in history and the branch still holds exactly one report-only commit after main.
  const fixture = makeFixture(t);
  const competitorSha = remoteMain(fixture);
  const result = runHelper(fixture, { wrapper: makeGitRaceWrapper(fixture, 'absent-competitor', competitorSha) });
  assert.equal(result.status, 0, result.stderr || result.error);
  const after = remoteRef(fixture);
  assert.equal(git(fixture.work, ['rev-list', '--parents', '-n', '1', after]).trim().split(/\s+/)[1], competitorSha);
});

test('identical report-only branch passes the final exact-ref guard without mutation', (t) => {
  const fixture = makeFixture(t);
  const before = createRemoteReportBranch(fixture, fixture.reportText);
  const result = runHelper(fixture);
  assertNoOp(result);
  assert.equal(remoteRef(fixture), before);
});

test('branch movement after inspection rejects the final no-op guard without pushing', (t) => {
  const fixture = makeFixture(t);
  createRemoteReportBranch(fixture, fixture.reportText);
  const competitorSha = createCompetitorCommit(fixture, 'moved branch\n', 'move-competitor');
  const result = runHelper(fixture, { wrapper: makeGitRaceWrapper(fixture, 'final-move', competitorSha) });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(remoteRef(fixture), competitorSha);
  assert.doesNotMatch(result.output, /pushed=false/);
});

test('branch deletion after inspection rejects the final no-op guard without pushing', (t) => {
  const fixture = makeFixture(t);
  createRemoteReportBranch(fixture, fixture.reportText);
  const result = runHelper(fixture, { wrapper: makeGitRaceWrapper(fixture, 'final-delete') });
  assert.notEqual(result.status, 0);
  assert.equal(remoteRef(fixture), null);
  assert.doesNotMatch(result.output, /pushed=false/);
});

test('unobservable or malformed final observations reject the no-op', (t) => {
  for (const mode of ['final-fail', 'final-malformed']) {
    const fixture = makeFixture(t, `report-${mode}\n`);
    createRemoteReportBranch(fixture, fixture.reportText);
    const result = runHelper(fixture, { wrapper: makeGitRaceWrapper(fixture, mode) });
    assert.notEqual(result.status, 0, mode);
    assert.doesNotMatch(result.output, /pushed=false/, mode);
  }
});

test('identical report after several report-only commits is a no-op', (t) => {
  const fixture = makeFixture(t, 'third report\n');
  const before = createRemoteReportBranch(fixture, ['first report\n', 'second report\n', 'third report\n']);
  const result = runHelper(fixture);
  assertNoOp(result);
  assert.equal(remoteRef(fixture), before);
});

test('changed report adds one commit on the verified tip and pushes without force', (t) => {
  const fixture = makeFixture(t, 'new report\n');
  const before = createRemoteReportBranch(fixture, 'old report\n');
  const result = runHelper(fixture);
  assert.equal(result.status, 0, result.stderr || result.error);
  assert.match(result.output, /^pushed=true$/m);
  const after = remoteRef(fixture);
  assert.ok(after);
  assert.notEqual(after, before);
  assert.equal(git(fixture.work, ['show', `${after}:${reportPath}`]), 'new report\n');
  assert.equal(git(fixture.work, ['rev-list', '--parents', '-n', '1', after]).trim().split(/\s+/)[1], before);
});

test('changed report on a multi-commit branch keeps every earlier report commit', (t) => {
  const fixture = makeFixture(t, 'third report\n');
  const before = createRemoteReportBranch(fixture, ['first report\n', 'second report\n']);
  const result = runHelper(fixture);
  assert.equal(result.status, 0, result.stderr || result.error);
  const after = remoteRef(fixture);
  assert.equal(git(fixture.work, ['merge-base', '--is-ancestor', before, after]), '');
  assert.equal(git(fixture.work, ['rev-list', '--count', `${remoteMain(fixture)}..${after}`]).trim(), '3');
});

test('main advancement with a changed report still fast-forwards the old branch line', (t) => {
  const fixture = makeFixture(t, 'new report\n');
  const before = createRemoteReportBranch(fixture, 'old report\n');
  writeFile(path.join(fixture.work, 'main-only.txt'), 'main advanced\n');
  git(fixture.work, ['switch', 'main']);
  git(fixture.work, ['add', 'main-only.txt']);
  git(fixture.work, ['commit', '-m', 'Advance trusted main only']);
  git(fixture.work, ['push', 'origin', 'main']);
  git(fixture.work, ['fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
  const result = runHelper(fixture);
  assert.equal(result.status, 0, result.stderr || result.error);
  const after = remoteRef(fixture);
  assert.equal(git(fixture.work, ['rev-list', '--parents', '-n', '1', after]).trim().split(/\s+/)[1], before);
});

test('changed report and a competing branch movement are rejected as a non-fast-forward', (t) => {
  const fixture = makeFixture(t, 'new report\n');
  createRemoteReportBranch(fixture, 'old report\n');
  const competitorSha = createCompetitorCommit(fixture, 'competitor report\n', 'push-competitor');
  const result = runHelper(fixture, { wrapper: makeGitRaceWrapper(fixture, 'push-competitor', competitorSha) });
  assert.notEqual(result.status, 0);
  assert.equal(remoteRef(fixture), competitorSha);
  assert.doesNotMatch(result.output, /pushed=true/);
});
