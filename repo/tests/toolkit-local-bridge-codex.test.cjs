'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  sourceHelperHookCommand,
  windowsSessionStartCommand,
  windowsHelperHookCommand,
  windowsCheckpointHookCommand,
  verifyInstalledCacheFreshness
} = require('../scripts/setup-codex-toolkit-plugin.cjs');
const {
  repoRoot,
  expectedBridgeVersion,
  tmpRoot,
  run,
  isolatedHomeEnv,
  readJson,
  git,
  writeFile,
  writeDisabledHookHub,
  completeCoreCacheFixture,
  createMinimalToolkitSource,
  readLatestReport,
  commitAll,
  createRepoAutoUpdateFixture,
  currentCommit
} = require('./support/toolkit-local-bridge-fixture.cjs');

function writeCodexPluginRefreshFixture(repoPath) {
  writeFile(path.join(repoPath, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'ai-agent-toolkit',
    version: expectedBridgeVersion,
    hooks: './.codex-plugin/hooks/hooks.json'
  }, null, 2));
  writeFile(path.join(repoPath, '.codex-plugin', 'assets', 'fixture.txt'), 'fixture asset\n');
  // The real source hooks, so the fixture keeps up with every hook the plugin ships.
  writeFile(path.join(repoPath, '.codex-plugin', 'hooks', 'hooks.json'), fs.readFileSync(path.join(repoRoot, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8'));
  for (const relPath of [
    'repo/scripts/toolkit-codex-session-start.cjs',
    'repo/scripts/toolkit-codex-session-start.ps1',
  ]) {
    const target = path.join(repoPath, ...relPath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, ...relPath.split('/')), target);
  }
  completeCoreCacheFixture(repoPath);
  writeFile(path.join(repoPath, 'repo', 'scripts', 'setup-toolkit.cjs'), [
    '#!/usr/bin/env node',
    "'use strict';",
    ''
  ].join('\n'));
  writeFile(path.join(repoPath, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs'), [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const source = process.cwd();",
    "const oldRoot = process.env.PLUGIN_ROOT;",
    "if (!oldRoot) { console.error('missing PLUGIN_ROOT'); process.exit(9); }",
    "const target = process.env.TOOLKIT_TEST_CODEX_NEW_CACHE || oldRoot;",
    "fs.rmSync(oldRoot, { recursive: true, force: true });",
    "fs.rmSync(target, { recursive: true, force: true });",
    "fs.mkdirSync(path.dirname(target), { recursive: true });",
    "fs.cpSync(source, target, {",
    "  recursive: true,",
    "  filter: (src) => !src.split(path.sep).includes('.git')",
    "});",
    "if (process.platform === 'win32') {",
    "  const hooksPath = path.join(target, '.codex-plugin', 'hooks', 'hooks.json');",
    "  const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));",
    `  hooks.hooks.SessionStart[0].hooks[0].commandWindows = ${JSON.stringify(windowsSessionStartCommand())};`,
    "  for (const group of [...hooks.hooks.PreToolUse, ...hooks.hooks.UserPromptSubmit]) {",
    `    for (const hook of group.hooks) if (hook.command === ${JSON.stringify(sourceHelperHookCommand())}) hook.commandWindows = ${JSON.stringify(windowsHelperHookCommand())};`,
    "  }",
    `  hooks.hooks.Stop[0].hooks[0].commandWindows = ${JSON.stringify(windowsCheckpointHookCommand())};`,
    "  fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2) + '\\n');",
    "  const runtimePath = path.join(target, '.codex-plugin', 'session-start-runtime.json');",
    "  fs.writeFileSync(runtimePath, JSON.stringify({ schema: 1, node_path: process.execPath }, null, 2) + '\\n');",
    "}",
    "process.stdout.write(JSON.stringify({ ok: true, version: '9.9.9', cache_root: target }, null, 2));",
    ''
  ].join('\n'));
}

test('Codex SessionStart hook adds no missing-rule notice for current AGENTS', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  const template = fs.readFileSync(
    path.join(repoRoot, 'skills', 'repository-agent-rules', 'repo-local', 'AGENTS.managed.template.md'),
    'utf8'
  );
  writeFile(path.join(root, 'AGENTS.md'), template);
  const hub = path.join(root, '.test-home', 'hub', 'current');
  writeDisabledHookHub(hub);

  const result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    cwd: root,
    env: isolatedHomeEnv(path.join(root, '.test-home'), {
      PATH: process.env.PATH,
      PLUGIN_ROOT: repoRoot
    })
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Toolkit local bridge: auto-sync disabled; run node repo/scripts/toolkit-local-bridge.cjs --audit for status.\n');
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /STOP: Root AGENTS\.md is missing|repo-local repository-agent-rules are not installed/);
});

test('hook report tells user to run setup toolkit when Codex native plugin cache is stale', () => {
  const root = tmpRoot();
  const sourceRepo = createMinimalToolkitSource(root, { alpha: 'alpha codex cache source\n' });
  const stalePluginRoot = path.join(root, 'codex-cache', 'ai-agent-toolkit');
  const hub = path.join(root, 'hub', 'current');

  writeFile(path.join(stalePluginRoot, 'skills', 'alpha', 'SKILL.md'), 'old alpha cache\n');
  let result = run([
    '--hub', hub,
    '--repo-path', sourceRepo,
    '--write',
    '--enable-auto-sync',
    '--enable-auto-sync',
    '--sync-source', 'codex-plugin'
  ], { env: isolatedHomeEnv(root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root, {
      PATH: process.env.PATH,
      PLUGIN_ROOT: stalePluginRoot
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);

  const report = readLatestReport(hub);
  assert.match(report.text, /Codex native plugin cache: `stale`/);
  assert.match(report.text, /Action needed: enable Codex plugin auto-refresh in setup, or run `setup toolkit`\./);
  assert.match(report.text, /Enable Codex plugin auto-refresh|run `setup toolkit`/);
  assert.match(report.state.last_update_report_signature, /^[a-f0-9]{64}$/);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root, {
      PATH: process.env.PATH,
      PLUGIN_ROOT: stalePluginRoot
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Toolkit local bridge sync complete\./);
  const repeatedState = readJson(path.join(hub, 'state.json'));
  assert.equal(repeatedState.last_update_report_path, report.reportPath);
  assert.equal(repeatedState.last_update_report_signature, report.state.last_update_report_signature);
});

test('hook report does not ask to enable Codex auto-refresh when it is already enabled', () => {
  const fixture = createRepoAutoUpdateFixture();
  const root = fixture.root;
  const sourceRepo = fixture.repo;
  const stalePluginRoot = path.join(root, 'codex-cache', 'ai-agent-toolkit');
  const hub = path.join(root, 'hub', 'current');

  writeCodexPluginRefreshFixture(sourceRepo);
  writeFile(path.join(stalePluginRoot, 'skills', 'alpha', 'SKILL.md'), 'old alpha cache\n');
  let result = run([
    '--hub', hub,
    '--repo-path', sourceRepo,
    '--write',
    '--enable-auto-sync',
    '--enable-codex-plugin-auto-refresh',
    '--enable-auto-sync',
    '--sync-source', 'codex-plugin'
  ], { env: isolatedHomeEnv(root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root, {
      PATH: process.env.PATH,
      PLUGIN_ROOT: stalePluginRoot
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);

  const report = readLatestReport(hub);
  assert.match(report.text, /Action needed: none\./);
  assert.match(report.text, /Codex plugin updated to 9\.9\.9\. It takes effect in your next Codex session\./);
  assert.match(report.text, /Codex native plugin cache: `refreshed`/);
  assert.doesNotMatch(report.text, /Enable Codex plugin auto-refresh/);
  assert.doesNotMatch(report.text, /run `setup toolkit`/);
});

test('Codex auto-refresh across a version bump checks the newly installed cache folder', () => {
  const fixture = createRepoAutoUpdateFixture();
  const root = fixture.root;
  const oldPluginRoot = path.join(root, 'codex-cache', 'ai-agent-toolkit', '3.6.0');
  const newPluginRoot = path.join(root, 'codex-cache', 'ai-agent-toolkit', '3.7.0');
  const hub = path.join(root, 'hub', 'current');

  writeCodexPluginRefreshFixture(fixture.repo);
  writeFile(path.join(oldPluginRoot, 'skills', 'alpha', 'SKILL.md'), 'old alpha cache\n');
  let result = run([
    '--hub', hub, '--repo-path', fixture.repo, '--write', '--enable-auto-sync',
    '--enable-codex-plugin-auto-refresh', '--sync-source', 'codex-plugin'
  ], { env: isolatedHomeEnv(root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH, PLUGIN_ROOT: oldPluginRoot, TOOLKIT_TEST_CODEX_NEW_CACHE: newPluginRoot })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(oldPluginRoot), false, 'the folder the hook ran from was replaced');
  assert.equal(fs.existsSync(path.join(newPluginRoot, '.codex-plugin', 'plugin.json')), true);
  const report = readLatestReport(hub);
  assert.match(report.text, /Codex native plugin cache: `refreshed`/);
  assert.match(report.text, /Codex plugin updated to 9\.9\.9\. It takes effect in your next Codex session\./);
  assert.doesNotMatch(report.text, /refresh-failed|run `setup toolkit`/);
});

test('hook auto-refreshes stale Codex native plugin cache only after setup opt-in', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const stalePluginRoot = path.join(fixture.root, 'codex-cache', 'ai-agent-toolkit');
  writeCodexPluginRefreshFixture(fixture.repo);
  const refreshedCommit = commitAll(fixture.repo, 'add codex plugin refresh fixture');
  git(fixture.repo, ['push', 'origin', 'main']);
  writeFile(path.join(stalePluginRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), '// stale bridge cache\n');

  let result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-branch', 'main',
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-codex-plugin-auto-refresh',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      PLUGIN_ROOT: stalePluginRoot
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);
  assert.equal(currentCommit(fixture.repo), refreshedCommit);
  assert.deepEqual(
    verifyInstalledCacheFreshness(stalePluginRoot, fixture.repo),
    [],
    'auto-refresh should leave the installed plugin cache matching the trusted repo'
  );

  const report = readLatestReport(hub);
  assert.match(report.text, /Codex plugin updated to 9\.9\.9\. It takes effect in your next Codex session\./);
  assert.match(report.text, /Codex native plugin cache: `refreshed`/);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.codex_plugin_auto_refresh_enabled, true);
});

test('Codex auto-refresh runs before a delegated hub sync failure', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const stalePluginRoot = path.join(fixture.root, 'codex-cache', 'ai-agent-toolkit');
  writeFile(path.join(stalePluginRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), '// stale bridge cache\n');

  let result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-branch', 'main',
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-codex-plugin-auto-refresh',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  writeCodexPluginRefreshFixture(fixture.upstream);
  writeFile(path.join(fixture.upstream, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), [
    '#!/usr/bin/env node',
    "'use strict';",
    "console.error('Refusing downgrade: delegated fixture is intentionally older than hub state');",
    'process.exit(42);',
    ''
  ].join('\n'));
  git(fixture.upstream, ['add', '.']);
  git(fixture.upstream, ['commit', '-m', 'refresh codex cache but fail delegated sync']);
  git(fixture.upstream, ['push', 'origin', 'main']);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      PLUGIN_ROOT: stalePluginRoot
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);
  assert.match(result.stdout, /delegated repo sync failed/);
  assert.deepEqual(
    verifyInstalledCacheFreshness(stalePluginRoot, fixture.repo),
    [],
    'auto-refresh should still update the Codex plugin cache before delegated sync failure is reported'
  );

  const report = readLatestReport(hub);
  assert.match(report.text, /Codex plugin updated to 9\.9\.9\. It takes effect in your next Codex session\./);
  assert.match(report.text, /Codex native plugin cache: `refreshed`/);
  assert.match(report.text, /repo update status: `sync-delegation-failed`/);
  assert.match(report.text, /warning\/error: `delegated repo sync failed:/);
});

test('Toolkit exposes a local Codex marketplace wrapper for supported plugin install', () => {
  const marketplace = readJson(path.join(repoRoot, '.agents', 'plugins', 'marketplace.json'));
  assert.equal(marketplace.name, 'ai-agent-toolkit-local');
  assert.equal(marketplace.interface.displayName, 'AI Agent Toolkit local');
  assert.equal(Array.isArray(marketplace.plugins), true);
  assert.equal(marketplace.plugins.length, 1);
  assert.deepEqual(marketplace.plugins[0], {
    name: 'ai-agent-toolkit',
    source: {
      source: 'local',
      path: '.'
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_USE'
    },
    category: 'Developer Tools'
  });
});
