'use strict';

// update-source-watch-review-branch.sh: expected-absence and present leases, the final exact-ref
// guard, and races injected through a git wrapper. Report shapes and observation/push cases are in
// the -shapes and -observation files, so node --test runs the three in parallel.

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  reportPath,
  git,
  gitSha,
  makeFixture,
  remoteRef,
  remoteMain,
  createRemoteReportBranch,
  createCompetitorCommit,
  makeGitRaceWrapper,
  runHelper,
  assertNoOp,
} = require('./update-source-watch-test-support.cjs');

test('branch absent and stable is created with the expected-absence lease', (t) => {
  const fixture = makeFixture(t);
  const result = runHelper(fixture);
  assert.equal(result.status, 0, result.stderr || result.error);
  assert.ok(remoteRef(fixture));
  assert.equal(remoteMain(fixture), gitSha(fixture.work, 'refs/remotes/origin/main'));
});

test('branch absent with a competing ancestor creation rejects the expected-absence lease', (t) => {
  const fixture = makeFixture(t);
  const competitorSha = remoteMain(fixture);
  const result = runHelper(fixture, { wrapper: makeGitRaceWrapper(fixture, 'absent-competitor', competitorSha) });
  assert.notEqual(result.status, 0);
  assert.equal(remoteRef(fixture), competitorSha);
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

test('changed report rebuilds from trusted main and pushes with the original present lease', (t) => {
  const fixture = makeFixture(t, 'new report\n');
  createRemoteReportBranch(fixture, 'old report\n');
  const beforeMain = remoteMain(fixture);
  const result = runHelper(fixture);
  assert.equal(result.status, 0, result.stderr || result.error);
  const after = remoteRef(fixture);
  assert.ok(after);
  assert.notEqual(after, null);
  assert.equal(git(fixture.work, ['show', `${after}:${reportPath}`]), 'new report\n');
  assert.equal(git(fixture.work, ['rev-list', '--parents', '-n', '1', after]).trim().split(/\s+/)[1], beforeMain);
});

test('changed report and a competing branch movement are rejected by the original present lease', (t) => {
  const fixture = makeFixture(t, 'new report\n');
  createRemoteReportBranch(fixture, 'old report\n');
  const competitorSha = createCompetitorCommit(fixture, 'competitor report\n', 'push-competitor');
  const result = runHelper(fixture, { wrapper: makeGitRaceWrapper(fixture, 'push-competitor', competitorSha) });
  assert.notEqual(result.status, 0);
  assert.equal(remoteRef(fixture), competitorSha);
});
