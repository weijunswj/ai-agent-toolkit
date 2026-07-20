'use strict';

const test = require('node:test');
const {
  assert, fs, path, tmpRoot, isolatedHomeEnv, createGitBackedSetupRepo, run
} = require('./toolkit-setup-test-support.cjs');

function privateFixture() {
  const root = tmpRoot();
  const home = path.join(root, 'synthetic-private-home');
  fs.mkdirSync(home, { recursive: true });
  return {
    ...createGitBackedSetupRepo(root),
    root,
    home,
    privateRepo: path.join(root, 'synthetic-private-repo-source'),
    privateCache: path.join(root, 'synthetic-private-plugin-cache')
  };
}

function assertPrivateHelperOutputAbsent(result, fixture) {
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  for (const forbidden of [
    '"source_path"', '"cache_path"', '"installed_entry"', '"installPath"',
    fixture.privateRepo, fixture.privateCache, fixture.home
  ]) assert.equal(output.includes(forbidden), false, `private helper output leaked: ${forbidden}`);
  assert.doesNotMatch(output, /\{\s*"ok"\s*:\s*true/);
}

test('Claude managed stale refresh captures write JSON and emits only the sanitized journey', () => {
  const fixture = privateFixture();
  const result = run([
    '--execute', '--host', 'claude-code', '--repo-root', fixture.setupRepo, '--repo-remote', fixture.origin,
    '--yes-recommended', '--claude-topology', 'root-only', '--claude-agent-capacity', 'root-only',
    '--claude-plugin-behavior', 'install'
  ], { env: {
    ...isolatedHomeEnv(fixture.home),
    SETUP_FAKE_CLAUDE_REFRESH_REQUIRED: '1',
    SETUP_FAKE_PRIVATE_REPO: fixture.privateRepo,
    SETUP_FAKE_PRIVATE_CACHE: fixture.privateCache
  }, timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Claude native plugin verification: current source identity was not established; approved refresh is required\./);
  assert.match(result.stdout, /Claude plugin manifest path: <managed-toolkit-checkout>/);
  assert.match(result.stdout, /Claude plugin status: refreshed/);
  assert.match(result.stdout, /Claude plugin updated this run: yes/);
  assert.equal(fs.existsSync(path.join(fixture.setupRepo, 'CLAUDE_PLUGIN_REFRESHED')), true);
  assertPrivateHelperOutputAbsent(result, fixture);
});

test('Codex managed stale refresh captures write JSON and emits only the sanitized journey', () => {
  const fixture = privateFixture();
  const result = run([
    '--execute', '--repo-root', fixture.setupRepo, '--repo-remote', fixture.origin,
    '--yes-recommended', '--enable-codex-plugin-auto-refresh', '--codex-helper-capacity', 'keep'
  ], { env: {
    ...isolatedHomeEnv(fixture.home),
    SETUP_FAKE_CODEX_REFRESH_REQUIRED: '1',
    SETUP_FAKE_PRIVATE_REPO: fixture.privateRepo,
    SETUP_FAKE_PRIVATE_CACHE: fixture.privateCache
  }, timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Codex native plugin verification: current source identity was not established; approved refresh is required\./);
  assert.match(result.stdout, /Codex plugin cache path: <Codex Toolkit cache>/);
  assert.match(result.stdout, /Codex plugin status: refreshed/);
  assert.match(result.stdout, /Codex plugin updated this run: yes/);
  assert.equal(fs.existsSync(path.join(fixture.setupRepo, 'CODEX_PLUGIN_REFRESHED')), true);
  assertPrivateHelperOutputAbsent(result, fixture);
});

test('Claude write-helper failure is bounded and does not echo captured private output', () => {
  const fixture = privateFixture();
  const result = run([
    '--execute', '--host', 'claude-code', '--repo-root', fixture.setupRepo, '--repo-remote', fixture.origin,
    '--yes-recommended', '--claude-topology', 'root-only', '--claude-agent-capacity', 'root-only',
    '--claude-plugin-behavior', 'install'
  ], { env: {
    ...isolatedHomeEnv(fixture.home),
    SETUP_FAKE_CLAUDE_REFRESH_REQUIRED: '1',
    SETUP_FAKE_CLAUDE_WRITE_FAILURE: '1',
    SETUP_FAKE_PRIVATE_REPO: fixture.privateRepo,
    SETUP_FAKE_PRIVATE_CACHE: fixture.privateCache
  }, timeout: 300000 });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /Claude native plugin mutation failed \(exit code 42\)\. Captured helper diagnostics were withheld from routine output\./);
  assertPrivateHelperOutputAbsent(result, fixture);
});

test('Codex write-helper failure is bounded and does not echo captured private output', () => {
  const fixture = privateFixture();
  const result = run([
    '--execute', '--repo-root', fixture.setupRepo, '--repo-remote', fixture.origin,
    '--yes-recommended', '--enable-codex-plugin-auto-refresh', '--codex-helper-capacity', 'keep'
  ], { env: {
    ...isolatedHomeEnv(fixture.home),
    SETUP_FAKE_CODEX_REFRESH_REQUIRED: '1',
    SETUP_FAKE_CODEX_WRITE_FAILURE: '1',
    SETUP_FAKE_PRIVATE_REPO: fixture.privateRepo,
    SETUP_FAKE_PRIVATE_CACHE: fixture.privateCache
  }, timeout: 300000 });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /Codex native plugin mutation failed \(exit code 41\)\. Captured helper diagnostics were withheld from routine output\./);
  assertPrivateHelperOutputAbsent(result, fixture);
});
