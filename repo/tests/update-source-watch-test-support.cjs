'use strict';

// Git fixtures, race wrappers and the helper runner shared by the update-source-watch-review-branch
// test files.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

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

// A Windows path as Git Bash reads it, by drive letter (D:\a\b -> /d/a/b). cygpath would map a path
// inside the temp folder to /tmp/..., and Git Bash binds /tmp to whichever temp folder its first
// process saw, so that form can point somewhere else in the helper's own bash.
function bashPathValue(value) {
  if (process.platform !== 'win32' || value.startsWith('/')) return value;
  const resolved = path.resolve(value);
  if (!/^[A-Za-z]:\\/.test(resolved)) throw new Error(`Unable to convert path: ${value}`);
  return `/${resolved[0].toLowerCase()}${resolved.slice(2).replace(/\\/g, '/')}`;
}

function bashSearchPath() {
  if (process.platform !== 'win32') return process.env.PATH;
  const result = spawnSync(bashPath, ['-lc', 'printf "%s" "$PATH"'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Unable to read Git Bash PATH');
  return result.stdout;
}

// The git the wrappers hand off to, as Git Bash itself finds it. On Windows, where.exe can return
// C:\Program Files\Git\bin\git.exe, which cygpath maps to /bin/git.exe, a path Git Bash cannot
// run because its /bin is usr\bin; asking bash avoids that translation.
function realGitPath() {
  if (process.platform === 'win32') {
    const result = spawnSync(bashPath, ['-lc', 'command -v git'], { encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout.trim()) throw new Error(result.stderr || 'Git Bash cannot find git');
    return result.stdout.trim();
  }
  return execFileSync('which', ['git'], { encoding: 'utf8' })
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
  // Mirrors the repository ruleset that blocks force-pushes on every branch.
  git(bare, ['config', 'receive.denyNonFastForwards', 'true']);
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

// Creates the notification branch from trusted main. `content` may be an array, which makes one
// report-only commit per entry, oldest first.
function createRemoteReportBranch(fixture, content, mutate = null, options = {}) {
  const source = cloneBranchSource(fixture, 'branch-source');
  git(source, ['switch', '-c', branchName, 'origin/main']);
  const contents = Array.isArray(content) ? content : [content];
  contents.forEach((entry, index) => {
    const last = index === contents.length - 1;
    writeFile(path.join(source, reportPath), entry);
    if (last && mutate) mutate(source);
    git(source, ['add', '--all']);
    const staged = git(source, ['diff', '--cached', '--name-status']).trim();
    if (!staged && !(last && options.emptyCommit)) {
      throw new Error(`report fixture was not staged (${entry}): ${git(source, ['status', '--short'])}`);
    }
    git(source, last && options.emptyCommit
      ? ['commit', '--allow-empty', '-m', 'Create report-only notification branch']
      : ['commit', '-m', 'Create report-only notification branch']);
  });
  if (options.executable) {
    const reportBlob = git(source, ['hash-object', '-w', reportPath]).trim();
    git(source, ['update-index', '--add', '--cacheinfo', `100755,${reportBlob},${reportPath}`]);
    git(source, ['commit', '--amend', '--no-edit']);
  }
  if (options.extraCommit) options.extraCommit(source);
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
  const pushLog = path.join(wrapperDir, 'pushes.log');
  const script = `#!/usr/bin/env bash
set -euo pipefail
real_git="${'${SOURCE_WATCH_REAL_GIT}'}"
counter="${'${SOURCE_WATCH_COUNTER}'}"
mode="${'${SOURCE_WATCH_RACE_MODE}'}"
remote_git_dir="${'${SOURCE_WATCH_REMOTE_GIT_DIR}'}"
competitor_sha="${'${SOURCE_WATCH_COMPETITOR_SHA:-}'}"
push_log="${'${SOURCE_WATCH_PUSH_LOG}'}"
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
if [[ "${'${1:-}'}" == 'push' ]]; then
  # Every push is logged. The competitor moves the branch only before the first push, so a
  # fallback that deletes and re-pushes would leave a visible trace instead of being masked.
  printf '%s\n' "$*" >> "$push_log"
  if [[ ("$mode" == 'absent-competitor' || "$mode" == 'push-competitor') && ! -f "$push_log.moved" ]]; then
    : > "$push_log.moved"
    "$real_git" --git-dir "$remote_git_dir" update-ref "refs/heads/${'${BRANCH}'}" "$competitor_sha"
  fi
fi
exec "$real_git" "$@"
`;
  const wrapperPath = path.join(wrapperDir, 'git');
  writeFile(wrapperPath, script);
  fs.chmodSync(wrapperPath, 0o755);
  return {
    wrapperDir,
    pushes() {
      return fs.existsSync(pushLog) ? fs.readFileSync(pushLog, 'utf8').trim().split('\n').filter(Boolean) : [];
    },
    env: {
      SOURCE_WATCH_PUSH_LOG: bashPathValue(pushLog),
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
      ...(wrapper ? wrapper.env : {}),
      ...(options.env || {})
    }
  });
  const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  return { ...result, output };
}

function assertNoOp(result) {
  assert.equal(result.status, 0, result.stderr || result.error);
  assert.match(result.output, /^pushed=false$/m);
}

module.exports = Object.freeze({
  repoRoot,
  helperPath,
  branchName,
  reportPath,
  bashPath,
  git,
  gitSha,
  bashPathValue,
  bashSearchPath,
  realGitPath,
  writeFile,
  configureGit,
  makeFixture,
  remoteRef,
  remoteMain,
  cloneBranchSource,
  createRemoteReportBranch,
  createCompetitorCommit,
  createStandaloneBranch,
  createRootCommitBranch,
  createUnrelatedParentBranch,
  createMergeBranch,
  createMissingBlobBranch,
  createSubmoduleBranch,
  createRenameBranch,
  createSymlinkBranch,
  makeGitRaceWrapper,
  runHelper,
  assertNoOp,
});
