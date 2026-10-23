'use strict';

// update-source-watch-review-branch.sh: malformed observations, main advancement, branch content as
// data, and how the push token is passed. Split from update-source-watch-review-branch.test.cjs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  git,
  writeFile,
  makeFixture,
  remoteRef,
  createRemoteReportBranch,
  makeGitRaceWrapper,
  runHelper,
  assertNoOp,
  bashPathValue,
  realGitPath,
} = require('./update-source-watch-test-support.cjs');

test('malformed initial observation is never used and a later valid observation re-establishes authority', (t) => {
  const fixture = makeFixture(t);
  const before = createRemoteReportBranch(fixture, fixture.reportText);
  const result = runHelper(fixture, { wrapper: makeGitRaceWrapper(fixture, 'malformed-initial') });
  assert.equal(result.status, 0, result.stderr || result.error);
  assert.equal(remoteRef(fixture), before);
  assert.match(result.output, /pushed=false/);
  assert.doesNotMatch(result.stderr, /not-a-full-sha/);
});

test('persistently malformed observations terminate without push or no-op', (t) => {
  const fixture = makeFixture(t);
  const result = runHelper(fixture, { wrapper: makeGitRaceWrapper(fixture, 'malformed-always') });
  assert.notEqual(result.status, 0);
  assert.equal(remoteRef(fixture), null);
  assert.doesNotMatch(result.output, /pushed=false/);
});

test('main advancement alone does not churn an identical report-only branch', (t) => {
  const fixture = makeFixture(t);
  const before = createRemoteReportBranch(fixture, fixture.reportText);
  writeFile(path.join(fixture.work, 'main-only.txt'), 'main advanced\n');
  git(fixture.work, ['switch', 'main']);
  git(fixture.work, ['add', 'main-only.txt']);
  git(fixture.work, ['commit', '-m', 'Advance trusted main only']);
  git(fixture.work, ['push', 'origin', 'main']);
  git(fixture.work, ['fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
  const result = runHelper(fixture);
  assertNoOp(result);
  assert.equal(remoteRef(fixture), before);
});

test('notification-branch content is inspected as data and never executed', (t) => {
  const fixture = makeFixture(t);
  const marker = path.join(fixture.root, 'source-watch-marker');
  fixture.reportText = `$(touch ${marker})\n`;
  writeFile(fixture.reportTemp, fixture.reportText);
  createRemoteReportBranch(fixture, fixture.reportText);
  const result = runHelper(fixture);
  assertNoOp(result);
  assert.equal(fs.existsSync(marker), false);
});

// A git wrapper that records how each push is authenticated. A push to an https remote stops
// here, so no test ever reaches the network.
function makePushRecorder(fixture) {
  const wrapperDir = path.join(fixture.root, 'wrapper-push-recorder');
  fs.mkdirSync(wrapperDir, { recursive: true });
  const record = path.join(wrapperDir, 'pushes.log');
  const script = `#!/usr/bin/env bash
set -euo pipefail
real_git="${'${SOURCE_WATCH_REAL_GIT}'}"
if [[ "${'${1:-}'}" == 'push' ]]; then
  printf 'count=%s key=%s value=%s url=%s\\n' "${'${GIT_CONFIG_COUNT:-}'}" "${'${GIT_CONFIG_KEY_0:-}'}" "${'${GIT_CONFIG_VALUE_0:-}'}" "$("$real_git" remote get-url origin)" >> "${'${SOURCE_WATCH_PUSH_RECORD}'}"
  if [[ "$("$real_git" remote get-url origin)" == https://* ]]; then exit 1; fi
fi
exec "$real_git" "$@"
`;
  const wrapperPath = path.join(wrapperDir, 'git');
  writeFile(wrapperPath, script);
  fs.chmodSync(wrapperPath, 0o755);
  return {
    record,
    wrapper: { wrapperDir, env: { SOURCE_WATCH_REAL_GIT: bashPathValue(realGitPath()), SOURCE_WATCH_PUSH_RECORD: bashPathValue(record) } },
  };
}

test('the push token reaches only the push, never .git/config or the remote URL', (t) => {
  const fixture = makeFixture(t);
  const token = 'source-watch-test-token-not-a-credential';
  const recorder = makePushRecorder(fixture);
  const originBefore = git(fixture.work, ['remote', 'get-url', 'origin']).trim();
  const result = runHelper(fixture, { wrapper: recorder.wrapper, env: { GH_TOKEN: token, GITHUB_REPOSITORY: 'owner/repo' } });
  assert.equal(result.status, 0, result.stderr || result.error);
  assert.match(result.output, /^pushed=true$/m);
  assert.ok(remoteRef(fixture), 'the review branch was pushed');
  assert.equal(git(fixture.work, ['remote', 'get-url', 'origin']).trim(), originBefore, 'remote URL unchanged');
  const config = fs.readFileSync(path.join(fixture.work, '.git', 'config'), 'utf8');
  assert.equal(config.includes(token), false, 'no token in .git/config');
  assert.equal(config.includes(Buffer.from(`x-access-token:${token}`).toString('base64')), false, 'no encoded token in .git/config');
  const pushes = fs.readFileSync(recorder.record, 'utf8').trim().split('\n');
  assert.equal(pushes.length, 1);
  assert.match(pushes[0], /^count=1 key=http\.https:\/\/github\.com\/\.extraheader value=AUTHORIZATION: basic \S+ url=/);
  const encoded = pushes[0].match(/value=AUTHORIZATION: basic (\S+)/)[1];
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), `x-access-token:${token}`);
});

test('without a token the push carries no credential configuration', (t) => {
  const fixture = makeFixture(t);
  const recorder = makePushRecorder(fixture);
  const result = runHelper(fixture, { wrapper: recorder.wrapper });
  assert.equal(result.status, 0, result.stderr || result.error);
  assert.match(fs.readFileSync(recorder.record, 'utf8'), /^count= key= value= url=/);
});
