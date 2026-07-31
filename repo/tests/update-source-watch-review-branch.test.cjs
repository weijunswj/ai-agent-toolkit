'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const helperPath = path.join(repoRoot, 'repo', 'scripts', 'update-source-watch-review-branch.sh');
const branchName = 'source-watch/review-active-third-party-updates';
const reportPath = 'repo/source-watch/reviews/active-third-party-updates.md';
const bashPath = process.platform === 'win32'
  ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'].find((candidate) => fs.existsSync(candidate)) || 'bash'
  : 'bash';

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options
  });
}

function gitSha(cwd, ref) {
  return git(cwd, ['rev-parse', ref]).trim();
}

function bashPathValue(value) {
  if (process.platform !== 'win32') return value;
  const escaped = value.replace(/'/g, "'\\''");
  const result = spawnSync(bashPath, ['-lc', `cygpath -u -- '${escaped}'`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `Unable to convert path: ${value}`);
  return result.stdout.trim();
}

function bashSearchPath() {
  if (process.platform !== 'win32') return process.env.PATH;
  const result = spawnSync(bashPath, ['-lc', 'printf "%s" "$PATH"'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Unable to read Git Bash PATH');
  return result.stdout;
}

function realGitPath() {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  return execFileSync(command, ['git'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function configureGit(cwd) {
  git(cwd, ['config', 'user.name', 'Source Watch Test']);
  git(cwd, ['config', 'user.email', 'source-watch-test@example.invalid']);
}

function makeFixture(t, reportText = 'review report\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-watch-cas-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bare = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  fs.mkdirSync(bare, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  git(bare, ['init', '--bare']);
  git(bare, ['config', 'receive.autogc', 'false']);
  git(bare, ['config', 'gc.auto', '0']);
  git(work, ['init', '--initial-branch=main']);
  configureGit(work);
  writeFile(path.join(work, 'README.md'), 'trusted main\n');
  git(work, ['add', 'README.md']);
  git(work, ['commit', '-m', 'Initial trusted main']);
  git(work, ['remote', 'add', 'origin', bare]);
  git(work, ['push', 'origin', 'main']);
  git(work, ['fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
  const reportTemp = path.join(root, 'generated-report.md');
  writeFile(reportTemp, reportText);
  return { root, bare, work, reportTemp, reportText };
}

function remoteRef(fixture, ref = branchName) {
  const result = git(fixture.work, ['ls-remote', 'origin', `refs/heads/${ref}`]).trim();
  return result ? result.split(/\s+/)[0] : null;
}

function remoteMain(fixture) {
  return remoteRef(fixture, 'main');
}

function cloneBranchSource(fixture, name) {
  const source = path.join(fixture.root, name);
  git(source, ['clone', '--branch', 'main', fixture.bare, source], { cwd: fixture.root });
  configureGit(source);
  return source;
}

function createRemoteReportBranch(fixture, content, mutate = null, options = {}) {
  const source = cloneBranchSource(fixture, 'branch-source');
  git(source, ['switch', '-c', branchName, 'origin/main']);
  writeFile(path.join(source, reportPath), content);
  if (mutate) mutate(source);
  git(source, ['add', '--all']);
  const staged = git(source, ['diff', '--cached', '--name-status']).trim();
  if (!staged && !options.emptyCommit) {
    throw new Error(`report fixture was not staged (${content}): ${git(source, ['status', '--short'])}`);
  }
  git(source, options.emptyCommit
    ? ['commit', '--allow-empty', '-m', 'Create report-only notification branch']
    : ['commit', '-m', 'Create report-only notification branch']);
  if (options.executable) {
    const reportBlob = git(source, ['hash-object', '-w', reportPath]).trim();
    git(source, ['update-index', '--add', '--cacheinfo', `100755,${reportBlob},${reportPath}`]);
    git(source, ['commit', '--amend', '--no-edit']);
  }
  git(source, ['push', 'origin', `HEAD:${branchName}`]);
  return gitSha(source, 'HEAD');
}

function createCompetitorCommit(fixture, content = 'competitor report\n', ref = 'source-watch-competitor') {
  const source = cloneBranchSource(fixture, `competitor-${ref.replace(/[^A-Za-z0-9-]/g, '-')}`);
  git(source, ['switch', '-c', ref, 'origin/main']);
  writeFile(path.join(source, reportPath), content);
  git(source, ['add', '--all']);
  git(source, ['commit', '-m', 'Prepare competing notification branch state']);
  git(source, ['push', 'origin', `HEAD:${ref}`]);
  return gitSha(source, 'HEAD');
}

function createStandaloneBranch(fixture, name, setup) {
  const source = path.join(fixture.root, name);
  fs.mkdirSync(source, { recursive: true });
  git(source, ['init', '--initial-branch=main']);
  configureGit(source);
  git(source, ['remote', 'add', 'origin', fixture.bare]);
  setup(source);
  git(source, ['push', 'origin', `HEAD:${branchName}`]);
  return gitSha(source, 'HEAD');
}

function createRootCommitBranch(fixture) {
  return createStandaloneBranch(fixture, 'root-source', (source) => {
    writeFile(path.join(source, reportPath), fixture.reportText);
    git(source, ['add', '--all']);
    git(source, ['commit', '-m', 'Create root report commit']);
  });
}

function createUnrelatedParentBranch(fixture) {
  return createStandaloneBranch(fixture, 'unrelated-source', (source) => {
    writeFile(path.join(source, 'unrelated.txt'), 'unrelated parent\n');
    git(source, ['add', '--all']);
    git(source, ['commit', '-m', 'Create unrelated root']);
    writeFile(path.join(source, reportPath), fixture.reportText);
    git(source, ['add', '--all']);
    git(source, ['commit', '-m', 'Create unrelated report commit']);
  });
}

function createMergeBranch(fixture) {
  const source = cloneBranchSource(fixture, 'merge-source');
  git(source, ['switch', '-c', 'source-watch-merge-side', 'origin/main']);
  writeFile(path.join(source, reportPath), fixture.reportText);
  git(source, ['add', '--all']);
  git(source, ['commit', '-m', 'Create merge side report']);
  git(source, ['switch', '-c', branchName, 'origin/main']);
  git(source, ['merge', '--no-ff', 'source-watch-merge-side', '-m', 'Create merge report commit']);
  git(source, ['push', 'origin', `HEAD:${branchName}`]);
  return gitSha(source, 'HEAD');
}

function createMissingBlobBranch(fixture) {
  const source = cloneBranchSource(fixture, 'missing-blob-source');
  git(source, ['switch', '-c', branchName, 'origin/main']);
  writeFile(path.join(source, reportPath), fixture.reportText);
  git(source, ['add', '--all']);
  git(source, ['commit', '-m', 'Create report with removable blob']);
  const commit = gitSha(source, 'HEAD');
  const blob = git(source, ['rev-parse', `HEAD:${reportPath}`]).trim();
  git(source, ['push', 'origin', `HEAD:${branchName}`]);
  const looseBlobPath = path.join(fixture.bare, 'objects', blob.slice(0, 2), blob.slice(2));
  if (!fs.existsSync(looseBlobPath)) {
    throw new Error(`missing-blob fixture object was not loose: ${looseBlobPath}`);
  }
  fs.rmSync(looseBlobPath);
  return commit;
}

function createSubmoduleBranch(fixture) {
  const source = cloneBranchSource(fixture, 'submodule-source');
  const submodule = path.join(fixture.root, 'submodule-repository');
  fs.mkdirSync(submodule, { recursive: true });
  git(submodule, ['init', '--initial-branch=main']);
  configureGit(submodule);
  writeFile(path.join(submodule, 'submodule.txt'), 'submodule\n');
  git(submodule, ['add', 'submodule.txt']);
  git(submodule, ['commit', '-m', 'Create submodule commit']);
  const submoduleCommit = gitSha(submodule, 'HEAD');
  git(source, ['update-index', '--add', '--cacheinfo', `160000,${submoduleCommit},${reportPath}`]);
  git(source, ['commit', '-m', 'Create submodule report entry']);
  git(source, ['push', 'origin', `HEAD:${branchName}`]);
  return gitSha(source, 'HEAD');
}

function createRenameBranch(fixture) {
  writeFile(path.join(fixture.work, 'repo', 'source-watch', 'reviews', 'old-report.md'), fixture.reportText);
  git(fixture.work, ['switch', 'main']);
  git(fixture.work, ['add', '--all']);
  git(fixture.work, ['commit', '-m', 'Seed rename source on trusted main']);
  git(fixture.work, ['push', 'origin', 'main']);
  git(fixture.work, ['fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
  const source = cloneBranchSource(fixture, 'rename-source');
  git(source, ['switch', '-c', branchName, 'origin/main']);
  git(source, ['mv', 'repo/source-watch/reviews/old-report.md', reportPath]);
  git(source, ['commit', '-m', 'Rename report path']);
  git(source, ['push', 'origin', `HEAD:${branchName}`]);
  return gitSha(source, 'HEAD');
}

function createSymlinkBranch(fixture) {
  const source = cloneBranchSource(fixture, 'symlink-source');
  git(source, ['switch', '-c', branchName, 'origin/main']);
  writeFile(path.join(source, 'symlink-target.md'), fixture.reportText);
  const report = path.join(source, reportPath);
  fs.mkdirSync(path.dirname(report), { recursive: true });
  try {
    fs.symlinkSync('symlink-target.md', report, 'file');
  } catch (error) {
    if (['EPERM', 'EINVAL', 'ENOTSUP', 'EACCES'].includes(error.code)) return null;
    throw error;
  }
  git(source, ['add', '--all']);
  git(source, ['commit', '-m', 'Create symlink report entry']);
  git(source, ['push', 'origin', `HEAD:${branchName}`]);
  return gitSha(source, 'HEAD');
}

function makeGitRaceWrapper(fixture, mode, competitorSha = '') {
  const wrapperDir = path.join(fixture.root, `wrapper-${mode}`);
  fs.mkdirSync(wrapperDir, { recursive: true });
  const counter = path.join(wrapperDir, 'counter');
  const script = `#!/usr/bin/env bash
set -euo pipefail
real_git="${'${SOURCE_WATCH_REAL_GIT}'}"
counter="${'${SOURCE_WATCH_COUNTER}'}"
mode="${'${SOURCE_WATCH_RACE_MODE}'}"
remote_git_dir="${'${SOURCE_WATCH_REMOTE_GIT_DIR}'}"
competitor_sha="${'${SOURCE_WATCH_COMPETITOR_SHA:-}'}"
count=0
if [[ "${'${1:-}'}" == 'ls-remote' ]]; then
  if [[ -f "$counter" ]]; then count="$(cat "$counter")"; fi
  count=$((count + 1))
  printf '%s\\n' "$count" > "$counter"
  if [[ "$mode" == 'malformed-initial' && "$count" == '1' ]]; then
    printf 'not-a-full-sha\\trefs/heads/%s\\n' "${'${BRANCH}'}"
    exit 0
  fi
  if [[ "$mode" == 'malformed-always' || ("$mode" == 'final-malformed' && "$count" == '2') ]]; then
    printf 'not-a-full-sha\\trefs/heads/%s\\n' "${'${BRANCH}'}"
    exit 0
  fi
  if [[ "$count" == '2' && "$mode" == 'final-fail' ]]; then
    exit 1
  fi
  if [[ "$count" == '2' && ("$mode" == 'final-move' || "$mode" == 'final-present-competitor') ]]; then
    "$real_git" --git-dir "$remote_git_dir" update-ref "refs/heads/${'${BRANCH}'}" "$competitor_sha"
  fi
  if [[ "$count" == '2' && "$mode" == 'final-delete' ]]; then
    "$real_git" --git-dir "$remote_git_dir" update-ref -d "refs/heads/${'${BRANCH}'}"
  fi
fi
if [[ "${'${1:-}'}" == 'push' && ("$mode" == 'absent-competitor' || "$mode" == 'push-competitor') ]]; then
  "$real_git" --git-dir "$remote_git_dir" update-ref "refs/heads/${'${BRANCH}'}" "$competitor_sha"
fi
exec "$real_git" "$@"
`;
  const wrapperPath = path.join(wrapperDir, 'git');
  writeFile(wrapperPath, script);
  fs.chmodSync(wrapperPath, 0o755);
  return {
    wrapperDir,
    env: {
      SOURCE_WATCH_REAL_GIT: bashPathValue(realGitPath()),
      SOURCE_WATCH_COUNTER: bashPathValue(counter),
      SOURCE_WATCH_RACE_MODE: mode,
      SOURCE_WATCH_REMOTE_GIT_DIR: bashPathValue(fixture.bare),
      SOURCE_WATCH_COMPETITOR_SHA: competitorSha
    }
  };
}

function runHelper(fixture, options = {}) {
  const outputPath = path.join(fixture.root, 'github-output');
  const wrapper = options.wrapper;
  const shellCommand = wrapper
    ? 'PATH="$SOURCE_WATCH_WRAPPER_PATH:$PATH"; export PATH; source "$SOURCE_WATCH_HELPER"'
    : 'source "$SOURCE_WATCH_HELPER"';
  const result = spawnSync(bashPath, ['-c', shellCommand], {
    cwd: fixture.work,
    encoding: 'utf8',
    env: {
      PATH: bashSearchPath(),
      SOURCE_WATCH_HELPER: bashPathValue(helperPath),
      ...(wrapper ? { SOURCE_WATCH_WRAPPER_PATH: bashPathValue(wrapper.wrapperDir) } : {}),
      BRANCH: branchName,
      REPORT_TEMP: bashPathValue(fixture.reportTemp),
      REPORT_PATH: reportPath,
      GITHUB_OUTPUT: bashPathValue(outputPath),
      GITHUB_REPOSITORY: '',
      GH_TOKEN: '',
      ...(wrapper ? wrapper.env : {})
    }
  });
  const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  return { ...result, output };
}

function assertNoOp(result) {
  assert.equal(result.status, 0, result.stderr || result.error);
  assert.match(result.output, /^pushed=false$/m);
}

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
