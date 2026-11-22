'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

// Repo auto-update during a hook run: a clean checkout is fast-forwarded or switched back to main before
// the sync, and a checkout that cannot be updated (dirty, another remote, diverged, failing validation) is
// recorded with its reason, and the sync is not delegated. The report names what the run did.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  createRepoAutoUpdateFixture,
  expectedBridgeVersion,
  git,
  writeFile,
  writeJson,
  writeRepoToolkitFixture,
  commitAll,
  currentCommit,
  isolatedHomeEnv,
  readJson,
  readLatestReport,
  run
} = require('./support/toolkit-local-bridge-fixture.cjs');

function currentBranch(repoPath) {
  return git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

function pushRepoToolkitUpdate(fixture, label) {
  writeRepoToolkitFixture(fixture.upstream, label);
  const commit = commitAll(fixture.upstream, `update ${label}`);
  git(fixture.upstream, ['push', 'origin', 'main']);
  return commit;
}

// A written report prints "sync complete", or the action-needed line when the run needs action.
function reportPathFromOutput(stdout, hub) {
  assert.match(String(stdout || ''), /^(?:Toolkit local bridge sync complete\.|Toolkit: action needed \(.+\. Tell the owner before other work\.)$/m);
  const reportPath = readJson(path.join(hub, 'state.json')).last_update_report_path;
  assert.ok(reportPath, stdout);
  return reportPath;
}

test('hook report is generated when repo auto-update fast-forwards and lists changed files', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  const updatedCommit = pushRepoToolkitUpdate(fixture, 'report-fast-forward');
  let result = run([
    '--hub', hub,
    '--repo-path', fixture.repo,
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-auto-sync',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker
    })
  });
  assert.equal(result.status, 0, result.stderr);
  const reportPath = reportPathFromOutput(result.stdout, hub);
  const report = readLatestReport(hub);
  assert.equal(path.resolve(report.reportPath), path.resolve(reportPath));
  assert.match(report.text, /^# AI Agent Toolkit Update/m);
  assert.match(report.text, new RegExp(`Toolkit updated to commit: \`${updatedCommit}\``));
  assert.match(report.text, new RegExp(`Previous commit: \`${fixture.initialCommit}\``));
  assert.match(report.text, /Running bridge source: `codex-plugin`/);
  assert.equal(report.text.includes(`Running bridge version: \`${expectedBridgeVersion}\``), true);
  assert.match(report.text, /Recorded repo version:/);
  assert.match(report.text, /Recorded Codex plugin version:/);
  assert.doesNotMatch(report.text, /Recorded Claude plugin version:/, 'a Codex report never describes Claude');
  assert.match(report.text, /Hub reporting version:/);
  assert.match(report.text, /Downgrade enforcement scope: `codex-plugin only`/);
  assert.match(report.text, /- `VERSION\.txt`/);
  assert.match(report.text, /- `skills\/fixture-skill\/SKILL\.md`/);
  assert.match(report.text, /repo update status: `updated`/);
  assert.match(report.text, /hook-light validation: `passed`/);
  assert.match(report.text, /Skipped live n8n systems; not touched\./);
});

test('no-op repo auto-update hook with unchanged observed commit does not create a report', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  let result = run([
    '--hub', hub,
    '--repo-path', fixture.repo,
    '--repo-branch', 'main',
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'repo'], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Toolkit local bridge sync complete\./);
  let state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_update_report_path || '', '');
  assert.equal(state.last_repo_update_status, 'up-to-date');
  assert.equal(state.last_repo_update_to_commit, fixture.initialCommit);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'repo'], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Toolkit local bridge sync complete\./);
  state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_update_report_path || '', '');
});

test('hook report is generated when repo was already advanced before the hook run', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  let result = run([
    '--hub', hub,
    '--repo-path', fixture.repo,
    '--repo-branch', 'main',
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'repo'], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(path.join(hub, 'state.json')).last_repo_update_to_commit, fixture.initialCommit);

  const updatedCommit = pushRepoToolkitUpdate(fixture, 'already-advanced');
  git(fixture.repo, ['fetch', 'origin', 'main']);
  git(fixture.repo, ['merge', '--ff-only', 'FETCH_HEAD']);
  assert.equal(currentCommit(fixture.repo), updatedCommit);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'repo'], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  const report = readLatestReport(hub);
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);
  assert.match(report.text, /Local repo was already advanced before this hook run\./);
  assert.match(report.text, /Likely from a manual pull or another local Git update\./);
  assert.match(report.text, /Configured branch: `main`/);
  assert.match(report.text, new RegExp(`Configured remote: \`${fixture.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``));
  assert.match(report.text, new RegExp(`Previous observed commit: \`${fixture.initialCommit}\``));
  assert.match(report.text, new RegExp(`Current commit: \`${updatedCommit}\``));
  assert.match(report.text, /repo update status: `up-to-date`/);
});

test('hook mode refuses a dirty repo before update and does not sync targets', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  let result = run([
    '--hub', hub,
    '--repo-path', fixture.repo,
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-auto-sync',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);
  git(fixture.repo, ['checkout', '-b', 'feature-work']);
  writeFile(path.join(fixture.repo, 'DIRTY.txt'), 'dirty\n');

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(currentBranch(fixture.repo), 'feature-work');
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_repo_update_status, 'skipped');
  assert.match(state.last_repo_update_error, /dirty/i);
  const report = readLatestReport(hub);
  assert.match(result.stdout, /^Toolkit: action needed \(this session start\): .+ Update report: toolkit-update-[\d-]+\.md in the Toolkit update-report folder\. Tell the owner before other work\.$/m);
  assert.match(report.text, /Repo: skipped \(configured Toolkit source checkout is dirty\)\./);
  const repoPattern = fixture.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(report.text, new RegExp(`Action needed: the configured Toolkit source checkout \\(\`${repoPattern}\`\\) has uncommitted changes, so startup updates stay skipped until it is clean: commit or stash them there, or run \`setup toolkit\` to use a dedicated clean \`main\` checkout\\.`));
  assert.doesNotMatch(report.text, /will retry on the next hook run/);
  assert.match(report.text, new RegExp(`Configured repo path: \`${fixture.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``));
  assert.match(report.text, /repo update status: `skipped`/);
  assert.match(report.text, /warning\/error: `dirty working tree`/i);
  assert.match(report.text, /Suggested fix: the configured Toolkit source checkout \(`[^`]+`\) has uncommitted changes, so startup updates stay skipped until it is clean/);
});

test('hook mode auto-switches a clean repo back to main before update and sync', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  let result = run([
    '--hub', hub,
    '--repo-path', fixture.repo,
    '--repo-branch', 'main',
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-auto-sync',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  git(fixture.repo, ['checkout', '-b', 'feature-work']);
  assert.equal(currentBranch(fixture.repo), 'feature-work');

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker
    })
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(currentBranch(fixture.repo), 'main');
  assert.equal(fs.existsSync(marker), true);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_repo_update_status, 'up-to-date');
  assert.equal(state.last_repo_update_error || '', '');
  const report = readLatestReport(hub);
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);
  assert.match(report.text, /## TL;DR/);
  assert.match(report.text, /Repo: auto-switched to `main`; already up to date\./);
  assert.match(report.text, /Bridge action: auto-switched clean Toolkit repo from `feature-work` to `main`\./);
});

test('hook mode rejects a repo whose origin remote does not match configured remote', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  let result = run([
    '--hub', hub,
    '--repo-path', fixture.repo,
    '--repo-remote', `${fixture.origin}-other`,
    '--enable-auto-sync',
    '--enable-auto-sync',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_repo_update_status, 'skipped');
  assert.match(state.last_repo_update_error, /remote/i);
});

test('hook mode performs a fast-forward repo update before delegating sync', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  const updatedCommit = pushRepoToolkitUpdate(fixture, 'fast-forward');
  let result = run([
    '--hub', hub,
    '--repo-path', fixture.repo,
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-auto-sync',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(currentCommit(fixture.repo), fixture.initialCommit);
  const preUpdateState = readJson(path.join(hub, 'state.json'));
  preUpdateState.bridge_versions_by_source.repo = '9.9.9';
  preUpdateState.hub_version = '9.9.9';
  writeJson(path.join(hub, 'state.json'), preUpdateState);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(currentCommit(fixture.repo), updatedCommit);

  const delegateArgs = fs.readFileSync(marker, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(delegateArgs.length, 1);
  assert.deepEqual(delegateArgs[0], [
    '--sync-enabled',
    '--write',
    '--sync-source',
    'repo',
    '--hub',
    hub,
    '--skip-repo-auto-update',
    '--suppress-update-report'
  ]);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_repo_update_status, 'updated');
  assert.equal(state.bridge_versions_by_source.repo, '9.9.9');
  assert.equal(state.bridge_versions_by_source['codex-plugin'], expectedBridgeVersion);
  assert.equal(state.hub_version, '9.9.9');
  assert.equal(state.last_repo_update_from_commit, fixture.initialCommit);
  assert.equal(state.last_repo_update_to_commit, updatedCommit);
});

test('repo update failure does not sync targets', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  let result = run([
    '--hub', hub,
    '--repo-path', fixture.repo,
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-auto-sync',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  writeFile(path.join(fixture.repo, 'LOCAL.txt'), 'local\n');
  const localCommit = commitAll(fixture.repo, 'local divergence');
  pushRepoToolkitUpdate(fixture, 'remote-divergence');

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(currentCommit(fixture.repo), localCommit);
  assert.equal(fs.existsSync(marker), false);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_repo_update_status, 'skipped');
  assert.match(state.last_repo_update_error, /fast-forward/i);
});

test('validation failure after update does not sync targets', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  const updatedCommit = pushRepoToolkitUpdate(fixture, 'validation-failure');
  let result = run([
    '--hub', hub,
    '--repo-path', fixture.repo,
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-auto-sync',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker,
      TOOLKIT_BRIDGE_TEST_VALIDATE_FAIL: '1'
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(currentCommit(fixture.repo), updatedCommit);
  assert.equal(fs.existsSync(marker), false);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_repo_update_status, 'validation-failed');
  assert.equal(state.last_repo_update_from_commit, fixture.initialCommit);
  assert.equal(state.last_repo_update_to_commit, updatedCommit);
  assert.match(state.last_repo_update_error, /validate-toolkit/i);
  const report = readLatestReport(hub);
  assert.match(result.stdout, /^Toolkit: action needed \(this session start\): .+ Update report: toolkit-update-[\d-]+\.md in the Toolkit update-report folder\. Tell the owner before other work\.$/m);
  assert.match(report.text, /repo update status: `validation-failed`/);
  assert.match(report.text, /hook-light validation: `failed/);
  assert.match(report.text, /- `VERSION\.txt`/);
});

test('skip repo auto-update guard prevents recursive repo update', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: '2.0.0',
    auto_sync_enabled: false,
    repo_auto_update_enabled: true,
    repo_path: path.join(fixture.root, 'missing-repo'),
    repo_branch: 'main',
    repo_remote: fixture.origin,
    targets: {}
  });

  const result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--skip-repo-auto-update'], {
    env: { TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(readJson(path.join(hub, 'state.json')).last_repo_update_status || '', '');
});
