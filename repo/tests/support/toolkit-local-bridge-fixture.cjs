'use strict';

// Shared fixtures for the toolkit-local-bridge*.test.cjs files. The helpers and constants below moved
// verbatim from repo/tests/toolkit-local-bridge.test.cjs; repoRoot resolves three folders up because
// this file sits in repo/tests/support/.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const script = path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs');
const expectedBridgeVersion = '3.8.0';

function tmpRoot() {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-bridge-'));
  return fs.realpathSync.native(created);
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout || 300000
  });
}

function isolatedHomeEnv(root, extra = {}) {
  return {
    PATH: '',
    USERPROFILE: root,
    HOME: root,
    LOCALAPPDATA: path.join(root, 'local-app-data'),
    VIRTUAL_ENV: '',
    CONDA_PREFIX: '',
    UV_PYTHON: '',
    ...extra
  };
}

// The Claude hook maintains only the installed Toolkit copy: the one Claude Code's plugin
// registry names. This records `runningRoot` there inside the isolated `root`, in the same
// shape `claude plugin marketplace add` and `claude plugin install` write.
function installToolkitCopy(root, runningRoot = repoRoot) {
  const configDir = path.join(root, '.claude');
  writeJson(path.join(configDir, 'plugins', 'known_marketplaces.json'), {
    'ai-agent-toolkit-local': { source: { source: 'directory', path: runningRoot }, installLocation: runningRoot }
  });
  writeJson(path.join(configDir, 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: {
      'ai-agent-toolkit@ai-agent-toolkit-local': [{
        scope: 'user',
        version: expectedBridgeVersion,
        installPath: path.join(configDir, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', expectedBridgeVersion)
      }]
    }
  });
  return configDir;
}

// Environment for a Claude hook run in the isolated `root`: its Claude config folder is kept there too,
// and the running Toolkit copy is this worktree, the one installToolkitCopy records by default.
function claudeHookEnv(root, extra = {}) {
  return isolatedHomeEnv(root, { CLAUDE_CONFIG_DIR: path.join(root, '.claude'), CLAUDE_PLUGIN_ROOT: repoRoot, ...extra });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function git(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
    timeout: 60000
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed in ${cwd}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  return result.stdout.trim();
}

function writeFile(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function writeDisabledHookHub(hub) {
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: expectedBridgeVersion,
    auto_sync_enabled: false,
    repo_path: repoRoot
  });
}

const CORE_CACHE_FIXTURE_PATHS = Object.freeze([
  'repo/contracts/toolkit-local-bridge/version.json',
  'repo/scripts/toolkit-gate-contract-compiler.cjs',
  'repo/scripts/toolkit-capability-registry.cjs',
  'repo/contracts/agent-rules/global-rules.md',
  'repo/contracts/agent-rules/n8n-safety-router-adapter.md',
  'repo/CONTROLLER.md',
  'repo/ARCHITECTURE.md',
]);
const CORE_CACHE_FIXTURE_DIRS = Object.freeze([
  'repo/contracts/control-plane-kernel',
  'repo/contracts/repository-capability-registry',
  'repo/scripts/toolkit-control-plane',
  'repo/contracts/controller-kernel',
]);

function completeCoreCacheFixture(repoPath, includeFiles = true) {
  if (includeFiles) fs.cpSync(path.join(repoRoot,'repo/scripts'),path.join(repoPath,'repo/scripts'),{recursive:true,force:false});
  for (const relPath of includeFiles ? CORE_CACHE_FIXTURE_PATHS : []) {
    const target = path.join(repoPath, ...relPath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, ...relPath.split('/')), target);
  }
  for (const relPath of CORE_CACHE_FIXTURE_DIRS) {
    fs.cpSync(path.join(repoRoot, ...relPath.split('/')),
      path.join(repoPath, ...relPath.split('/')), { recursive: true });
  }
}

function createMinimalToolkitSource(root, skills = { alpha: 'alpha v1\n', beta: 'beta v1\n' }) {
  const repo = path.join(root, 'source-repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init']);
  git(repo, ['checkout', '-B', 'main']);
  configureGitUser(repo);
  for (const [name, body] of Object.entries(skills)) {
    writeFile(path.join(repo, 'skills', name, 'SKILL.md'), [
      '---',
      `name: ${name}`,
      `description: ${name} fixture skill for Toolkit bridge tests`,
      '---',
      '',
      body.trimEnd(),
      ''
    ].join('\n'));
    writeFile(path.join(repo, 'skills', name, 'README.md'), `${name} readme\n`);
  }
  commitAll(repo, 'minimal toolkit skills');
  return repo;
}

function readLatestReport(hub) {
  const state = readJson(path.join(hub, 'state.json'));
  assert.ok(state.last_update_report_path, 'state should record latest update report path');
  assert.equal(fs.existsSync(state.last_update_report_path), true, 'latest update report should exist');
  return {
    state,
    reportPath: state.last_update_report_path,
    text: fs.readFileSync(state.last_update_report_path, 'utf8')
  };
}

function configureGitUser(repoPath) {
  git(repoPath, ['config', 'user.email', 'toolkit-test@example.invalid']);
  git(repoPath, ['config', 'user.name', 'Toolkit Bridge Test']);
  git(repoPath, ['config', 'core.autocrlf', 'false']);
}

function writeHookLightSmokeFixture(repoPath) {
  writeFile(path.join(repoPath, 'repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs'), [
    "'use strict';",
    "const assert = require('node:assert/strict');",
    "const test = require('node:test');",
    "test('fixture bridge smoke test passes', () => assert.equal(true, true));",
    ''
  ].join('\n'));
}

function writeRepoToolkitFixture(repoPath, label) {
  writeFile(path.join(repoPath, 'VERSION.txt'), `${label}\n`);
  writeFile(path.join(repoPath, 'skills', 'fixture-skill', 'SKILL.md'), [
    '---',
    'name: fixture-skill',
    `description: Fixture Toolkit skill for bridge repo source tests ${label}`,
    '---',
    '',
    `# Fixture Skill ${label}`,
    ''
  ].join('\n'));
  writeFile(path.join(repoPath, 'skills', 'fixture-skill', 'README.md'), `fixture ${label}\n`);
  writeFile(path.join(repoPath, 'repo', 'scripts', 'validate-toolkit.cjs'), [
    '#!/usr/bin/env node',
    "'use strict';",
    "if (process.env.TOOLKIT_BRIDGE_TEST_VALIDATE_FAIL === '1') {",
    "  console.error('validation failed by fixture');",
    '  process.exit(7);',
    '}',
    ''
  ].join('\n'));
  for (const name of ['toolkit-local-bridge.test.cjs', 'toolkit-local-bridge-codex.test.cjs', 'toolkit-local-bridge-claude.test.cjs']) {
    writeFile(path.join(repoPath, 'repo', 'tests', name), [
      "'use strict';",
      "const assert = require('node:assert/strict');",
      "const test = require('node:test');",
      "test('fixture bridge tests pass', () => assert.equal(true, true));",
      ''
    ].join('\n'));
  }
  writeHookLightSmokeFixture(repoPath);
  writeFile(path.join(repoPath, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('node:fs');",
    "const marker = process.env.TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER;",
    "if (marker) fs.appendFileSync(marker, `${JSON.stringify(process.argv.slice(2))}\\n`, 'utf8');",
    "if (!process.argv.includes('--skip-repo-auto-update')) {",
    "  console.error('missing recursion guard');",
    '  process.exit(43);',
    '}',
    ''
  ].join('\n'));
  for (const name of [
    'codex-delegation-backup.cjs',
    'codex-delegation-common.cjs',
    'codex-delegation-config.cjs',
    'codex-delegation-layout.cjs',
    'codex-delegation-state.cjs',
    'setup-toolkit-core.cjs',
    'repo-ignore-hygiene.cjs',
    'repo-local-backup.cjs',
    'toolkit-agent-control.cjs',
    'claude-process-launch.cjs',
    'toolkit-staging-generations.cjs'
  ]) {
    writeFile(path.join(repoPath, 'repo', 'scripts', name), "'use strict';\n");
  }
}

function commitAll(repoPath, message) {
  git(repoPath, ['add', '.']);
  git(repoPath, ['commit', '-m', message]);
  return git(repoPath, ['rev-parse', 'HEAD']);
}

function createRepoAutoUpdateFixture() {
  const root = tmpRoot();
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  const upstream = path.join(root, 'upstream');
  git(root, ['init', '--bare', origin]);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init']);
  git(repo, ['checkout', '-B', 'main']);
  configureGitUser(repo);
  writeRepoToolkitFixture(repo, 'initial');
  const initialCommit = commitAll(repo, 'initial toolkit fixture');
  git(repo, ['remote', 'add', 'origin', origin]);
  git(repo, ['push', '-u', 'origin', 'main']);
  git(root, ['--git-dir', origin, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(root, ['clone', origin, upstream]);
  configureGitUser(upstream);
  return { root, origin, repo, upstream, initialCommit };
}

function currentCommit(repoPath) {
  return git(repoPath, ['rev-parse', 'HEAD']);
}

module.exports = {
  repoRoot,
  script,
  expectedBridgeVersion,
  tmpRoot,
  run,
  isolatedHomeEnv,
  installToolkitCopy,
  claudeHookEnv,
  readJson,
  writeJson,
  git,
  writeFile,
  writeDisabledHookHub,
  CORE_CACHE_FIXTURE_PATHS,
  CORE_CACHE_FIXTURE_DIRS,
  completeCoreCacheFixture,
  createMinimalToolkitSource,
  readLatestReport,
  configureGitUser,
  writeHookLightSmokeFixture,
  writeRepoToolkitFixture,
  commitAll,
  createRepoAutoUpdateFixture,
  currentCommit
};
