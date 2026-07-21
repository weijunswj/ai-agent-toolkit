'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const setup = require('../scripts/setup-claude-toolkit-plugin.cjs');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-toolkit-plugin-'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function expectedVersion() {
  return setup.readExpectedToolkitVersion(repoRoot);
}

function installedList(options = {}) {
  const version = options.version || expectedVersion();
  return {
    installed: [
      {
        name: setup.TOOLKIT_PLUGIN_NAME,
        marketplace: setup.TOOLKIT_MARKETPLACE_NAME,
        version,
        enabled: options.enabled !== false,
        source: { path: options.sourcePath || repoRoot },
        installPath: options.installPath || repoRoot
      }
    ]
  };
}

function writeFakeClaude(stateDir, options = {}) {
  const fakeClaudeScript = path.join(stateDir, 'fake-claude.cjs');
  const initialVersion = options.installedVersion || expectedVersion();
  writeJson(path.join(stateDir, 'state.json'), {
    repoRoot: options.initialRepoRoot || (options.initialInstalled ? repoRoot : ''),
    installed: Boolean(options.initialInstalled),
    scope: options.initialInstalled ? 'user' : '',
    version: initialVersion,
    failListRemaining: options.failListTimes || 0,
    marketplaceAddCount: 0,
    installCount: 0,
    updateCount: 0,
    uninstallCount: 0,
    trusted: options.trusted === undefined ? true : options.trusted,
    hooksActive: options.hooksActive === undefined ? true : options.hooksActive
  });
  const failMarketplaceAdd = Boolean(options.failMarketplaceAdd);
  const failInstall = Boolean(options.failInstall);
  const failUpdate = Boolean(options.failUpdate);
  const failUninstall = Boolean(options.failUninstall);
  // Lingering fakes finish (or skip) their real work and then stay alive on
  // a timer instead of exiting, exactly like a CLI that has landed its
  // mutation but does not exit cleanly.
  const lingerAfterInstall = Boolean(options.lingerAfterInstall);
  const lingerAfterUpdate = Boolean(options.lingerAfterUpdate);
  const installNeverLands = Boolean(options.installNeverLands);
  const updateSilentNoop = Boolean(options.updateSilentNoop);
  const updatedVersion = options.updatedVersion || expectedVersion();
  fs.writeFileSync(fakeClaudeScript, `
'use strict';

const fs = require('node:fs');

const statePath = ${JSON.stringify(path.join(stateDir, 'state.json'))};
const args = process.argv.slice(2);

function readState() {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function writeState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\\n');
}

function linger() {
  setInterval(() => {}, 1000);
}

if (args[0] === '--version') {
  process.stdout.write('claude 1.0.0 (fake)\\n');
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
  if (${JSON.stringify(failMarketplaceAdd)}) {
    process.stderr.write('fake marketplace add failure\\n');
    process.exit(1);
  }
  const state = readState();
  state.repoRoot = args[3];
  state.marketplaceAddCount += 1;
  writeState(state);
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'install') {
  if (${JSON.stringify(failInstall)}) {
    process.stderr.write('fake install failure\\n');
    process.exit(1);
  }
  const state = readState();
  state.installCount += 1;
  if (${JSON.stringify(installNeverLands)}) {
    writeState(state);
    linger();
    return;
  }
  state.installed = true;
  state.version = ${JSON.stringify(updatedVersion)};
  const scopeIndex = args.indexOf('--scope');
  state.scope = scopeIndex !== -1 ? args[scopeIndex + 1] : 'user';
  writeState(state);
  if (${JSON.stringify(lingerAfterInstall)}) {
    linger();
    return;
  }
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'update') {
  if (${JSON.stringify(failUpdate)}) {
    process.stderr.write('fake update failure\\n');
    process.exit(1);
  }
  const state = readState();
  state.updateCount += 1;
  if (${JSON.stringify(updateSilentNoop)}) {
    writeState(state);
    process.exit(0);
  }
  if (!state.installed) {
    process.stderr.write('fake update failure: not installed\\n');
    process.exit(1);
  }
  state.version = ${JSON.stringify(updatedVersion)};
  const scopeIndex = args.indexOf('--scope');
  if (scopeIndex !== -1) state.scope = args[scopeIndex + 1];
  writeState(state);
  if (${JSON.stringify(lingerAfterUpdate)}) {
    linger();
    return;
  }
  process.exit(0);
}

if (args[0] === 'plugin' && (args[1] === 'uninstall' || args[1] === 'remove')) {
  if (${JSON.stringify(failUninstall)}) {
    process.stderr.write('fake uninstall failure\\n');
    process.exit(1);
  }
  const state = readState();
  state.installed = false;
  state.uninstallCount += 1;
  writeState(state);
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'list') {
  const state = readState();
  // Transient list failures arm only after a mutation was invoked, so they
  // land inside the verification polling loop rather than failing the
  // initial pre-mutation state read.
  if (state.failListRemaining > 0 && (state.updateCount + state.installCount) > 0) {
    state.failListRemaining -= 1;
    writeState(state);
    process.stderr.write('fake transient plugin list failure\\n');
    process.exit(1);
  }
  const installed = state.installed ? [
    {
      name: ${JSON.stringify(setup.TOOLKIT_PLUGIN_NAME)},
      marketplace: ${JSON.stringify(setup.TOOLKIT_MARKETPLACE_NAME)},
      version: state.version,
      enabled: true,
      scope: state.scope || 'user',
      source: { path: state.repoRoot },
      installPath: state.repoRoot,
      trusted: state.trusted,
      hooksActive: state.hooksActive
    }
  ] : [];
  process.stdout.write(JSON.stringify({ installed }) + '\\n');
  process.exit(0);
}

process.stderr.write('unexpected fake claude args: ' + args.join(' ') + '\\n');
process.exit(9);
`, 'utf8');
  return fakeClaudeScript;
}

function readFakeClaudeState(stateDir) {
  return JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf8'));
}

function runSetup(mode, fakeClaudePath, extraArgs = [], options = {}) {
  // Short fixture-specific mutation deadlines and fast polling keep the
  // verification-driven install/update loops from waiting real minutes.
  const env = {
    CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS: '8000',
    CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS: '50',
    ...(options.env || process.env)
  };
  const args = [
    path.join(repoRoot, 'repo', 'scripts', 'setup-claude-toolkit-plugin.cjs'),
    mode,
    '--json',
    '--repo-root',
    repoRoot,
  ];
  if (options.explicit !== false) args.push('--claude-cli', fakeClaudePath);
  args.push(...extraArgs);
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
    env
  });
}

test('Claude Toolkit plugin source validates manifest and marketplace wrapper', () => {
  assert.deepEqual(setup.validateRepoPluginSource(repoRoot), []);
});

test('Claude Toolkit plugin marketplace wrapper validator rejects wrong name/source', () => {
  assert.match(
    setup.validateMarketplaceWrapper({ name: 'wrong', plugins: [] }).join('\n'),
    /local marketplace name must be/i
  );
  assert.match(
    setup.validateMarketplaceWrapper({ name: setup.TOOLKIT_MARKETPLACE_NAME, plugins: [] }).join('\n'),
    /must expose/i
  );
  assert.match(
    setup.validateMarketplaceWrapper({
      name: setup.TOOLKIT_MARKETPLACE_NAME,
      plugins: [{ name: setup.TOOLKIT_PLUGIN_NAME, source: '.' }]
    }).join('\n'),
    /marketplace source must be local path/i
  );
});

test('Claude Toolkit plugin SessionStart hook validator requires sync-source claude-plugin', () => {
  const dir = tmpRoot();
  const hooksPath = path.join(dir, 'hooks.json');

  writeJson(hooksPath, {
    hooks: {
      SessionStart: [{
        hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-local-bridge.cjs" --hook --sync-enabled --write --sync-source claude-plugin' }]
      }],
      PreToolUse: [{
        matcher: 'Agent|Task',
        hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-claude-agent-hook.cjs"' }]
      }]
    }
  });
  assert.deepEqual(setup.verifySessionStartHook(hooksPath), []);

  writeJson(hooksPath, {
    hooks: {
      SessionStart: [{
        hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-local-bridge.cjs" --hook --sync-enabled --write --sync-source codex-plugin' }]
      }]
    }
  });
  assert.match(setup.verifySessionStartHook(hooksPath).join('\n'), /--sync-source claude-plugin/);

  writeJson(hooksPath, { hooks: {} });
  assert.match(setup.verifySessionStartHook(hooksPath).join('\n'), /SessionStart hook/);

  writeJson(hooksPath, {
    hooks: {
      SessionStart: [{
        hooks: [{ type: 'command', command: 'node bridge.cjs --hook --sync-enabled --write --sync-source claude-plugin --enable-target opencode' }]
      }]
    }
  });
  assert.match(setup.verifySessionStartHook(hooksPath).join('\n'), /must not enable, disable, or force-downgrade/);
});

test('Claude Toolkit plugin state evaluator accepts a matching enabled install', () => {
  const state = setup.evaluateClaudeToolkitPluginState(installedList(), { repoRoot });
  assert.equal(state.ok, true);
  assert.deepEqual(state.errors, []);
});

test('Claude Toolkit plugin state evaluator rejects missing, disabled, stale, or wrong-source installs', () => {
  let state = setup.evaluateClaudeToolkitPluginState({ installed: [] }, { repoRoot });
  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /is not installed/i);

  state = setup.evaluateClaudeToolkitPluginState(installedList({ enabled: false }), { repoRoot });
  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /not enabled/i);

  state = setup.evaluateClaudeToolkitPluginState(installedList({ version: '0.0.1' }), { repoRoot });
  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /expected version/i);

  state = setup.evaluateClaudeToolkitPluginState(installedList({ sourcePath: tmpRoot() }), { repoRoot });
  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /source identity does not match/i);
});

test('Claude Toolkit plugin state evaluator refuses implicit downgrade from newer install', () => {
  const state = setup.evaluateClaudeToolkitPluginState(installedList({ version: '9.9.9' }), {
    repoRoot,
    expectedVersion: expectedVersion()
  });

  assert.equal(state.ok, false);
  assert.equal(state.refusesDowngrade, true);
  assert.equal(state.canUpdateInPlace, false, 'a newer-than-expected install must never be offered as an in-place update target');
  assert.match(state.errors.join('\n'), /Refusing downgrade/i);
});

test('Claude Toolkit plugin state evaluator flags an older enabled correctly-sourced install as updatable in place', () => {
  const state = setup.evaluateClaudeToolkitPluginState(installedList({ version: '2.3.0' }), {
    repoRoot,
    expectedVersion: expectedVersion()
  });

  assert.equal(state.ok, false);
  assert.equal(state.staleVersion, true);
  assert.equal(state.refusesDowngrade, false);
  assert.equal(state.canUpdateInPlace, true);
});

test('Claude Toolkit plugin state evaluator does not offer an in-place update for a disabled or wrong-source stale install', () => {
  let state = setup.evaluateClaudeToolkitPluginState(installedList({ version: '2.3.0', enabled: false }), {
    repoRoot,
    expectedVersion: expectedVersion()
  });
  assert.equal(state.staleVersion, true);
  assert.equal(state.canUpdateInPlace, false, 'a disabled install must go through full reinstall, not plugin update');

  state = setup.evaluateClaudeToolkitPluginState(installedList({ version: '2.3.0', sourcePath: tmpRoot() }), {
    repoRoot,
    expectedVersion: expectedVersion()
  });
  assert.equal(state.staleVersion, true);
  assert.equal(state.canUpdateInPlace, false, 'plugin update cannot fix a wrong marketplace source path');
});

test('Claude Toolkit plugin state evaluator accepts the real claude plugin list --json shape', () => {
  // Confirmed against a real Claude Code 2.1.197 install: a flat array of
  // { id: "name@marketplace", version, scope, enabled, projectPath } objects,
  // with no wrapping object and no separate name/marketplace fields.
  const realShapeList = [
    {
      id: `${setup.TOOLKIT_PLUGIN_NAME}@${setup.TOOLKIT_MARKETPLACE_NAME}`,
      version: expectedVersion(),
      scope: 'user',
      enabled: true,
      installPath: repoRoot,
      installedAt: '2026-07-01T14:44:35.944Z',
      lastUpdated: '2026-07-01T14:44:35.944Z',
      projectPath: repoRoot
    }
  ];
  const state = setup.evaluateClaudeToolkitPluginState(realShapeList, { repoRoot });
  assert.equal(state.ok, true);
  assert.deepEqual(state.errors, []);
});

test('Claude Toolkit plugin state evaluator accepts current plugin-list output without projectPath using bound registry evidence', () => {
  const commit = 'a'.repeat(40);
  const currentShapeList = [{
    id: `${setup.TOOLKIT_PLUGIN_NAME}@${setup.TOOLKIT_MARKETPLACE_NAME}`,
    version: expectedVersion(),
    scope: 'user',
    enabled: true,
    installPath: repoRoot
  }];
  const registryState = {
    knownMarketplaces: {
      [setup.TOOLKIT_MARKETPLACE_NAME]: { source: { source: 'directory', path: repoRoot } }
    },
    installedPlugins: {
      plugins: {
        [`${setup.TOOLKIT_PLUGIN_NAME}@${setup.TOOLKIT_MARKETPLACE_NAME}`]: [{
          scope: 'user',
          version: expectedVersion(),
          installPath: repoRoot,
          gitCommitSha: commit
        }]
      }
    },
    repoCommit: commit
  };

  const state = setup.evaluateClaudeToolkitPluginState(currentShapeList, { repoRoot, registryState });
  assert.equal(state.ok, true);
  assert.equal(state.sourceIdentity, 'claude-plugin-registry');
  assert.equal(state.sourcePath, repoRoot);
  assert.deepEqual(state.errors, []);
});

test('path-less current Claude state fails closed when registry source, install, or commit identity is not exact', () => {
  const commit = 'a'.repeat(40);
  const install = {
    id: `${setup.TOOLKIT_PLUGIN_NAME}@${setup.TOOLKIT_MARKETPLACE_NAME}`,
    version: expectedVersion(),
    scope: 'user',
    enabled: true,
    installPath: repoRoot
  };
  const validRegistry = {
    knownMarketplaces: {
      [setup.TOOLKIT_MARKETPLACE_NAME]: { source: { source: 'directory', path: repoRoot } }
    },
    installedPlugins: {
      plugins: {
        [`${setup.TOOLKIT_PLUGIN_NAME}@${setup.TOOLKIT_MARKETPLACE_NAME}`]: [{
          scope: 'user', version: expectedVersion(), installPath: repoRoot, gitCommitSha: commit
        }]
      }
    },
    repoCommit: commit
  };

  for (const registryState of [
    { ...validRegistry, knownMarketplaces: {} },
    { ...validRegistry, installedPlugins: { plugins: {} } },
    { ...validRegistry, repoCommit: 'b'.repeat(40) }
  ]) {
    const state = setup.evaluateClaudeToolkitPluginState([install], { repoRoot, registryState });
    assert.equal(state.ok, false);
    assert.equal(state.canUpdateInPlace, false);
  }
});

test('an explicit wrong plugin-list source cannot be overridden by matching registry evidence or leaked in errors', () => {
  const wrongSource = tmpRoot();
  const state = setup.evaluateClaudeToolkitPluginState(installedList({ sourcePath: wrongSource }), {
    repoRoot,
    registryState: {
      knownMarketplaces: { [setup.TOOLKIT_MARKETPLACE_NAME]: { source: { path: repoRoot } } },
      installedPlugins: { plugins: {} },
      repoCommit: 'a'.repeat(40)
    }
  });
  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /source identity does not match/i);
  assert.equal(state.errors.join('\n').includes(wrongSource), false);
});

test('claudeSpawnParts routes PATH-resolved bare Windows commands through an explicit non-shell cmd contract', { skip: process.platform !== 'win32' }, () => {
  const root = tmpRoot();
  const wrapper = path.join(root, 'claude.cmd');
  fs.writeFileSync(wrapper, '@echo off\r\nexit /b 0\r\n');
  const parts = setup.claudeSpawnParts('claude', ['plugin', 'marketplace', 'add', 'C:\\Users\\a b\\repo'], {
    env: { ...process.env, PATH: root, Path: root, PATHEXT: '.CMD' },
  });
  assert.equal(parts.shell, false);
  assert.match(parts.command, /cmd\.exe$/i);
  assert.deepEqual(parts.args.slice(0, 4), ['/d', '/s', '/v:off', '/c']);
  assert.match(parts.args[4], /claude\.CMD.*plugin.*marketplace.*add/i);
  assert.equal(parts.windowsVerbatimArguments, true);
});

test('strict enforcement requires host-reported trust and active hooks bound to exact installed bytes', () => {
  for (const options of [{ trusted: false }, { hooksActive: false }, { trusted: null }, { hooksActive: null }]) {
    const stateDir = tmpRoot();
    const result = runSetup('--verify', writeFakeClaude(stateDir, { initialInstalled: true, ...options }));
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.installed_current, true);
    assert.equal(summary.strict_enforcement_verified, false);
    assert.equal(summary.activation_proof, null);
  }

  const stateDir = tmpRoot();
  const result = runSetup('--verify', writeFakeClaude(stateDir, { initialInstalled: true }));
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.trusted, true);
  assert.equal(summary.hook_active, true);
  assert.equal(summary.strict_enforcement_verified, true);
  assert.equal(summary.activation_proof.plugin_version, expectedVersion());
  assert.equal(summary.activation_proof.schema, 3);
  for (const key of ['cache_identity', 'hook_sha256', 'controller_sha256', 'process_launch_sha256', 'agent_hook_sha256']) {
    assert.match(summary.activation_proof[key], /^[a-f0-9]{64}$/);
  }
  const processLaunchBytes = fs.readFileSync(path.join(repoRoot, 'repo', 'scripts', 'claude-process-launch.cjs'));
  assert.equal(summary.activation_proof.process_launch_sha256, crypto.createHash('sha256').update(processLaunchBytes).digest('hex'));
});

test('plugin setup cannot manufacture native trust or hook activation', () => {
  const stateDir = tmpRoot();
  const fake = writeFakeClaude(stateDir, { initialInstalled: false, trusted: false, hooksActive: false });
  const result = runSetup('--write', fake);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.trusted, false);
  assert.equal(summary.hook_active, false);
  assert.equal(summary.strict_enforcement_verified, false);
});

test('claudeSpawnParts executes explicit Windows exe paths directly and rejects ambiguous executable input', () => {
  if (process.platform === 'win32') {
    const executable = path.join(tmpRoot(), 'Program Files', 'Claude', 'claude.exe');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.copyFileSync(process.execPath, executable);
    const exe = setup.claudeSpawnParts(executable, ['--version']);
    assert.equal(exe.command, executable);
    assert.deepEqual(exe.args, ['--version']);
    assert.equal(exe.shell, false);
  } else {
    assert.throws(() => setup.claudeSpawnParts('C:\\Program Files\\Claude\\claude.exe', ['--version']), /must be absolute/i);
  }
  assert.throws(() => setup.claudeSpawnParts('claude & calc', ['--version']), /unsafe|Bare Claude/i);
  assert.throws(() => setup.claudeSpawnParts(' "claude" ', ['--version']), /ambiguous|unsafe/i);
});

test('claudeSpawnParts does not use a shell for a .cjs fake CLI path', () => {
  const fakePath = path.join(tmpRoot(), 'a b', 'fake-claude.cjs');
  fs.mkdirSync(path.dirname(fakePath), { recursive: true });
  fs.writeFileSync(fakePath, 'process.exit(0);\n');
  const parts = setup.claudeSpawnParts(fakePath, ['plugin', 'list', '--json']);
  assert.equal(parts.shell, false);
  assert.equal(parts.command, process.execPath);
  assert.deepEqual(parts.args, [fakePath, 'plugin', 'list', '--json']);
});

test('Claude Toolkit plugin setup verify fails cleanly when not installed', () => {
  const stateDir = tmpRoot();
  const fakeClaude = writeFakeClaude(stateDir, { initialInstalled: false });
  const result = runSetup('--verify', fakeClaude);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /is not installed/i);
});

test('Claude Toolkit plugin setup write installs and verify then reports success', () => {
  const stateDir = tmpRoot();
  const fakeClaude = writeFakeClaude(stateDir, { initialInstalled: false });

  const writeResult = runSetup('--write', fakeClaude);
  assert.equal(writeResult.status, 0, writeResult.stderr);
  const summary = JSON.parse(writeResult.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.scope, 'user');
  assert.equal(summary.version, expectedVersion());

  const verifyResult = runSetup('--verify', fakeClaude);
  assert.equal(verifyResult.status, 0, verifyResult.stderr);
});

test('Claude Toolkit plugin setup write surfaces marketplace/install command failures as warnings', () => {
  const stateDir = tmpRoot();
  const fakeClaude = writeFakeClaude(stateDir, { initialInstalled: false, failInstall: true });

  const writeResult = runSetup('--write', fakeClaude);
  assert.notEqual(writeResult.status, 0);
  assert.match(writeResult.stderr, /is not installed|did not exit cleanly/i);
});

test('Claude Toolkit plugin setup write refreshes a stale enabled correctly-sourced install with plugin update, not marketplace add + install', () => {
  const stateDir = tmpRoot();
  // `plugin install` is a no-op on an id that already exists (it just
  // reports "already installed"), so it can never refresh a stale cache by
  // itself. Deliberately break marketplace-add/install here: if setup fell
  // back to that path instead of `plugin update`, this write would fail.
  const fakeClaude = writeFakeClaude(stateDir, {
    initialInstalled: true,
    installedVersion: '2.3.0',
    failMarketplaceAdd: true,
    failInstall: true
  });

  const writeResult = runSetup('--write', fakeClaude);
  assert.equal(writeResult.status, 0, writeResult.stderr);
  const summary = JSON.parse(writeResult.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.version, expectedVersion());
  assert.deepEqual(summary.warnings, []);

  const state = readFakeClaudeState(stateDir);
  assert.equal(state.version, expectedVersion());
  assert.equal(state.installed, true);

  const verifyResult = runSetup('--verify', fakeClaude);
  assert.equal(verifyResult.status, 0, verifyResult.stderr);
});

test('Claude Toolkit plugin setup write falls back to uninstall and reinstall when plugin update fails', () => {
  const stateDir = tmpRoot();
  const fakeClaude = writeFakeClaude(stateDir, {
    initialInstalled: true,
    installedVersion: '2.3.0',
    failUpdate: true
  });

  const writeResult = runSetup('--write', fakeClaude);
  assert.equal(writeResult.status, 0, writeResult.stderr);
  assert.match(writeResult.stderr, /claude plugin update did not exit cleanly/i);
  const summary = JSON.parse(writeResult.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.version, expectedVersion());
  assert.ok(
    summary.warnings.some((warning) => /claude plugin update did not exit cleanly/i.test(warning)),
    summary.warnings.join('\n')
  );

  const state = readFakeClaudeState(stateDir);
  assert.equal(state.version, expectedVersion());
  assert.equal(state.installed, true);
});

test('Claude Toolkit plugin install that lands in state succeeds with a warning when the CLI process lingers', () => {
  const stateDir = tmpRoot();
  const fakeClaude = writeFakeClaude(stateDir, { initialInstalled: false, lingerAfterInstall: true });

  const writeResult = runSetup('--write', fakeClaude);
  assert.equal(writeResult.status, 0, writeResult.stderr);
  const summary = JSON.parse(writeResult.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.version, expectedVersion());
  assert.ok(
    summary.warnings.some((warning) => /plugin install .* did not exit cleanly, but installed-state verification passed/i.test(warning)),
    summary.warnings.join('\n')
  );

  const state = readFakeClaudeState(stateDir);
  assert.equal(state.installed, true);
  assert.equal(state.version, expectedVersion());

  const verifyResult = runSetup('--verify', fakeClaude);
  assert.equal(verifyResult.status, 0, verifyResult.stderr);
});

test('Claude Toolkit plugin install that never lands fails within the bounded deadline with state errors', () => {
  const stateDir = tmpRoot();
  const fakeClaude = writeFakeClaude(stateDir, { initialInstalled: false, installNeverLands: true });

  const env = { ...process.env, CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS: '1500', CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS: '50' };
  const started = Date.now();
  const writeResult = runSetup('--write', fakeClaude, [], { env });
  const elapsed = Date.now() - started;

  assert.notEqual(writeResult.status, 0);
  assert.match(writeResult.stderr, /did not produce a verified install within 1500ms/);
  assert.match(writeResult.stderr, /is not installed/i, 'failure must carry the final state errors');
  // Bounded: spawn overhead on a slow machine is tolerated, but the run must
  // not wait anywhere near the old unbounded/process-exit behavior.
  assert.ok(elapsed < 25000, `write took ${elapsed}ms`);
});

test('Claude Toolkit plugin update that verifies current despite a lingering process does not fall back to reinstall', () => {
  const stateDir = tmpRoot();
  const fakeClaude = writeFakeClaude(stateDir, {
    initialInstalled: true,
    installedVersion: '2.3.0',
    lingerAfterUpdate: true
  });

  const writeResult = runSetup('--write', fakeClaude);
  assert.equal(writeResult.status, 0, writeResult.stderr);
  const summary = JSON.parse(writeResult.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.version, expectedVersion());
  assert.ok(
    summary.warnings.some((warning) => /plugin update .* did not exit cleanly, but installed-state verification passed/i.test(warning)),
    summary.warnings.join('\n')
  );

  const state = readFakeClaudeState(stateDir);
  assert.equal(state.version, expectedVersion());
  assert.equal(state.updateCount, 1);
  assert.equal(state.uninstallCount, 0, 'a verified update must not trigger uninstall');
  assert.equal(state.marketplaceAddCount, 0, 'a verified update must not trigger marketplace re-add');
  assert.equal(state.installCount, 0, 'a verified update must not trigger reinstall');
});

test('Claude Toolkit plugin update that exits but never verifies falls back to reinstall with a deadline warning', () => {
  const stateDir = tmpRoot();
  const fakeClaude = writeFakeClaude(stateDir, {
    initialInstalled: true,
    installedVersion: '2.3.0',
    updateSilentNoop: true
  });

  const env = { ...process.env, CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS: '1500', CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS: '50' };
  const writeResult = runSetup('--write', fakeClaude, [], { env });
  assert.equal(writeResult.status, 0, writeResult.stderr);
  const summary = JSON.parse(writeResult.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.version, expectedVersion());
  assert.ok(
    summary.warnings.some((warning) => /plugin update did not produce a verified current install before its deadline, falling back to uninstall \+ reinstall/i.test(warning)),
    summary.warnings.join('\n')
  );

  const state = readFakeClaudeState(stateDir);
  assert.equal(state.version, expectedVersion());
  assert.equal(state.installed, true);
  assert.ok(state.uninstallCount >= 1, 'fallback must uninstall the stale install first');
  assert.ok(state.installCount >= 1, 'fallback must reinstall through the marketplace path');
});

test('Claude Toolkit plugin mutation polling tolerates transient plugin list failures until verification succeeds', () => {
  const stateDir = tmpRoot();
  // The lingering update never exits, so verification can only succeed by
  // polling through the two transient list failures to a later valid list.
  const fakeClaude = writeFakeClaude(stateDir, {
    initialInstalled: true,
    installedVersion: '2.3.0',
    lingerAfterUpdate: true,
    failListTimes: 2
  });

  const writeResult = runSetup('--write', fakeClaude);
  assert.equal(writeResult.status, 0, writeResult.stderr);
  const summary = JSON.parse(writeResult.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.version, expectedVersion());

  const state = readFakeClaudeState(stateDir);
  assert.equal(state.version, expectedVersion());
  assert.equal(state.failListRemaining, 0, 'transient list failures were consumed during polling');
  assert.equal(state.uninstallCount, 0, 'transient failures must not trigger the reinstall fallback');
});

test('setup orchestrator outer Claude timeouts cover the helper verification budgets with cleanup grace', () => {
  const orchestrator = require('../scripts/setup-toolkit.cjs');
  const budgets = orchestrator.claudeSetupBudgets();

  // The outer timeout must never undercut the helper's own bounded budgets:
  // resolve probe + plugin list for verify; the full mutation sequence with
  // both mutation phases for write. Both remain finite backstops.
  assert.equal(budgets.verify, setup.verifyBudgetMs());
  assert.equal(budgets.write, setup.writeBudgetMs());
  assert.ok(budgets.verify >= 10000 + 120000, 'verify budget covers probe + one plugin list');
  assert.ok(
    budgets.write >= setup.mutationDeadlineMs() * 2 + 120000 * 4 + 10000,
    'write budget covers both mutation phases plus the sync command steps'
  );
  assert.ok(Number.isFinite(budgets.write) && budgets.write < 60 * 60 * 1000, 'write budget stays bounded');

  // The maximum accepted poll interval must not undercut the outer budget:
  // polling waits are capped to the remaining deadline, so the budget is a
  // function of the deadline and command timeout only, never the interval.
  const savedPoll = process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS;
  try {
    process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS = String(60 * 60 * 1000);
    assert.equal(setup.writeBudgetMs(), budgets.write, 'poll interval must not change the write budget');
    assert.equal(setup.verifyBudgetMs(), budgets.verify, 'poll interval must not change the verify budget');
  } finally {
    if (savedPoll === undefined) delete process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS;
    else process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS = savedPoll;
  }
});

test('Claude Toolkit plugin mutation deadline and poll env controls reject malformed or unsafe values', () => {
  const savedDeadline = process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS;
  const savedPoll = process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS;
  try {
    // Strict decimal-integer parsing: partial-number forms that parseInt
    // would silently truncate must fall back, alongside zero, negatives,
    // whitespace-only input, and values above the documented maximum.
    for (const bad of ['abc', '0', '-100', String(2 * 60 * 60 * 1000), '100junk', '100.5', '1e3', '   ', '+100', '0x64']) {
      process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS = bad;
      assert.equal(setup.mutationDeadlineMs(), 120000, `deadline fallback for ${JSON.stringify(bad)}`);
    }
    for (const bad of ['abc', '0', '-5', '1', '50junk', '50.5', '5e2', '   ']) {
      process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS = bad;
      assert.equal(setup.mutationPollMs(), 500, `poll fallback for ${JSON.stringify(bad)}`);
    }
    process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS = '2000';
    process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS = '50';
    assert.equal(setup.mutationDeadlineMs(), 2000);
    assert.equal(setup.mutationPollMs(), 50);
    // A trimmed string of only decimal digits is accepted.
    process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS = ' 3000 ';
    assert.equal(setup.mutationDeadlineMs(), 3000);
  } finally {
    if (savedDeadline === undefined) delete process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS;
    else process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS = savedDeadline;
    if (savedPoll === undefined) delete process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS;
    else process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS = savedPoll;
  }
});

test('CLI resolution budgets one canonical precedence-selected command', () => {
  const saved = {
    aiCli: process.env.AI_AGENT_TOOLKIT_CLAUDE_CLI,
    envCli: process.env.CLAUDE_TOOLKIT_CLAUDE_CLI,
    cliPath: process.env.CLAUDE_CLI_PATH,
    probe: process.env.CLAUDE_TOOLKIT_CLAUDE_CLI_PROBE_TIMEOUT_MS
  };
  try {
    delete process.env.CLAUDE_TOOLKIT_CLAUDE_CLI;
    delete process.env.CLAUDE_CLI_PATH;
    delete process.env.AI_AGENT_TOOLKIT_CLAUDE_CLI;
    delete process.env.CLAUDE_TOOLKIT_CLAUDE_CLI_PROBE_TIMEOUT_MS;

    // One valid first candidate: with no explicit CLI and no env overrides
    // only bare `claude` is probed, and the budget stays at one probe.
    assert.deepEqual(setup.commandCandidates(''), ['claude']);
    assert.equal(setup.resolutionBudgetMs(''), 10000);
    assert.equal(setup.verifyBudgetMs(''), 10000 + 120000 + 15000);

    process.env.AI_AGENT_TOOLKIT_CLAUDE_CLI = 'ai-env-cli';
    process.env.CLAUDE_TOOLKIT_CLAUDE_CLI = 'env-cli-one';
    process.env.CLAUDE_CLI_PATH = 'env-cli-two';
    assert.deepEqual(setup.commandCandidates('explicit-cli'), ['explicit-cli']);
    assert.equal(setup.resolutionBudgetMs('explicit-cli'), 10000);
    assert.deepEqual(setup.commandCandidates(''), ['ai-env-cli']);

    // The orchestrator derives identical budgets for the same explicit
    // argument and environment, and stays finite.
    const orchestrator = require('../scripts/setup-toolkit.cjs');
    const budgets = orchestrator.claudeSetupBudgets('explicit-cli');
    assert.equal(budgets.verify, setup.verifyBudgetMs('explicit-cli'));
    assert.equal(budgets.write, setup.writeBudgetMs('explicit-cli'));
    assert.ok(Number.isFinite(budgets.verify) && Number.isFinite(budgets.write));

    // Static fallbacks match the one selected command at the default timeout.
    assert.equal(orchestrator.CLAUDE_SETUP_VERIFY_TIMEOUT_FALLBACK_MS, setup.verifyBudgetMs('explicit-cli'));
    assert.equal(orchestrator.CLAUDE_SETUP_WRITE_TIMEOUT_FALLBACK_MS, setup.writeBudgetMs('explicit-cli'));

    // The probe timeout override flows into the budget and is strict-parsed.
    process.env.CLAUDE_TOOLKIT_CLAUDE_CLI_PROBE_TIMEOUT_MS = '3000';
    assert.equal(setup.probeTimeoutMs(), 3000);
    assert.equal(setup.resolutionBudgetMs('explicit-cli'), 3000);
    for (const bad of ['abc', '0', '-5', '10junk', '1e3', String(2 * 60 * 60 * 1000)]) {
      process.env.CLAUDE_TOOLKIT_CLAUDE_CLI_PROBE_TIMEOUT_MS = bad;
      assert.equal(setup.probeTimeoutMs(), 10000, `probe fallback for ${JSON.stringify(bad)}`);
    }
  } finally {
    for (const [key, value] of [
      ['CLAUDE_TOOLKIT_CLAUDE_CLI', saved.envCli],
      ['CLAUDE_CLI_PATH', saved.cliPath],
      ['AI_AGENT_TOOLKIT_CLAUDE_CLI', saved.aiCli],
      ['CLAUDE_TOOLKIT_CLAUDE_CLI_PROBE_TIMEOUT_MS', saved.probe]
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('an unusable explicit CLI fails closed instead of falling through to a lower-precedence override', () => {
  const stateDir = tmpRoot();
  const fakeClaude = writeFakeClaude(stateDir, { initialInstalled: true });
  const brokenClaude = path.join(stateDir, 'broken-claude.cjs');
  fs.writeFileSync(brokenClaude, 'process.exit(1);\n', 'utf8');

  const env = {
    ...process.env,
    CLAUDE_TOOLKIT_CLAUDE_CLI: fakeClaude,
    CLAUDE_TOOLKIT_CLAUDE_CLI_PROBE_TIMEOUT_MS: '3000',
    CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS: '8000',
    CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS: '50'
  };
  const started = Date.now();
  const result = runSetup('--verify', brokenClaude, [], { env });
  const elapsed = Date.now() - started;

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No usable Claude Code CLI/i);
  assert.ok(elapsed < 60000, `resolution sequence took ${elapsed}ms`);
});

for (const variable of ['CLAUDE_TOOLKIT_CLAUDE_CLI', 'CLAUDE_CLI_PATH']) {
  test(`Claude helper verification uses ${variable} when it is the only available command`, () => {
    const stateDir = tmpRoot();
    const fakeClaude = writeFakeClaude(stateDir, { initialInstalled: true });
    const env = { ...process.env, PATH: '', Path: '', [variable]: fakeClaude };
    delete env.AI_AGENT_TOOLKIT_CLAUDE_CLI;
    if (variable !== 'CLAUDE_TOOLKIT_CLAUDE_CLI') delete env.CLAUDE_TOOLKIT_CLAUDE_CLI;
    if (variable !== 'CLAUDE_CLI_PATH') delete env.CLAUDE_CLI_PATH;
    const result = runSetup('--verify', fakeClaude, [], { env, explicit: false });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).installed_current, true);
  });
}

test('explicit Windows cmd path with spaces works through version and plugin verification', { skip: process.platform !== 'win32' }, () => {
  const stateDir = path.join(tmpRoot(), 'Claude CLI wrapper with spaces');
  fs.mkdirSync(stateDir, { recursive: true });
  const fakeClaude = writeFakeClaude(stateDir, { initialInstalled: true });
  const wrapper = path.join(stateDir, 'claude.cmd');
  fs.writeFileSync(wrapper, `@echo off\r\n"${process.execPath}" "${fakeClaude}" %*\r\n`);
  const result = runSetup('--verify', wrapper);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).installed_current, true);
});

test('mutation polling caps every wait to the remaining deadline even with an extreme poll interval', async () => {
  const stateDir = tmpRoot();
  const fakeClaude = writeFakeClaude(stateDir, { initialInstalled: false, installNeverLands: true });

  const started = Date.now();
  const outcome = await setup.runClaudeMutationAndVerify(
    fakeClaude,
    ['plugin', 'install', setup.pluginId(), '--scope', 'user'],
    { repoRoot, deadlineMs: 200, pollMs: 3600000 }
  );
  const elapsed = Date.now() - started;

  assert.equal(outcome.ok, false);
  assert.match(outcome.failure, /did not produce a verified install within 200ms/);
  // Near the deadline plus bounded spawn/list overhead on a slow machine --
  // never anywhere near the one-hour poll interval.
  assert.ok(elapsed < 30000, `deadline-capped polling took ${elapsed}ms`);
});

test('a final verification poll at the deadline can still succeed with an extreme poll interval', async () => {
  const stateDir = tmpRoot();
  // The install lands its state and lingers; with a one-hour poll interval,
  // success requires the loop's remaining-time-capped wait plus the final
  // at-deadline verification poll rather than a full poll sleep.
  const fakeClaude = writeFakeClaude(stateDir, { initialInstalled: false, initialRepoRoot: repoRoot, lingerAfterInstall: true });

  const started = Date.now();
  const outcome = await setup.runClaudeMutationAndVerify(
    fakeClaude,
    ['plugin', 'install', setup.pluginId(), '--scope', 'user'],
    { repoRoot, deadlineMs: 5000, pollMs: 3600000 }
  );
  const elapsed = Date.now() - started;

  assert.equal(outcome.ok, true, outcome.failure);
  assert.ok(elapsed < 30000, `verification-at-deadline took ${elapsed}ms`);
});

test('Claude Toolkit plugin setup rejects an unusable Claude CLI', () => {
  const stateDir = tmpRoot();
  const brokenClaude = path.join(stateDir, 'broken-claude.cjs');
  fs.writeFileSync(brokenClaude, "process.exit(1);\n", 'utf8');
  // Isolate PATH and CLI-override env vars so this fails even on a machine
  // that has a real, working Claude Code CLI installed globally -- otherwise
  // the resolver's bare-`claude` fallback candidate would mask the broken
  // explicit --claude-cli path and this test would no longer prove anything.
  const isolatedEnv = { ...process.env, PATH: process.env.SystemRoot ? `${process.env.SystemRoot}\\System32` : '/usr/bin' };
  delete isolatedEnv.CLAUDE_TOOLKIT_CLAUDE_CLI;
  delete isolatedEnv.CLAUDE_CLI_PATH;
  const result = runSetup('--verify', brokenClaude, [], { env: isolatedEnv });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no usable claude code cli/i);
});

test('installed enforcement byte verification rejects missing and stale cache files', () => {
  const cache = tmpRoot();
  for (const relPath of [
    '.claude-plugin/plugin.json',
    '.claude-plugin/hooks/hooks.json',
    'repo/scripts/toolkit-agent-control.cjs',
    'repo/scripts/claude-process-launch.cjs',
    'repo/scripts/toolkit-claude-agent-hook.cjs',
    'repo/scripts/repo-ignore-hygiene.cjs',
    'repo/scripts/repo-local-backup.cjs',
    'repo/scripts/toolkit-local-bridge.cjs',
  ]) {
    const target = path.join(cache, ...relPath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, ...relPath.split('/')), target);
  }
  assert.equal(setup.evaluateClaudeToolkitPluginState(installedList({ installPath: cache }), { repoRoot }).ok, true);
  fs.appendFileSync(path.join(cache, '.claude-plugin', 'hooks', 'hooks.json'), ' ');
  let state = setup.evaluateClaudeToolkitPluginState(installedList({ installPath: cache }), { repoRoot });
  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /stale.*hooks/i);
  fs.copyFileSync(path.join(repoRoot, '.claude-plugin', 'hooks', 'hooks.json'), path.join(cache, '.claude-plugin', 'hooks', 'hooks.json'));
  fs.unlinkSync(path.join(cache, 'repo', 'scripts', 'toolkit-agent-control.cjs'));
  state = setup.evaluateClaudeToolkitPluginState(installedList({ installPath: cache }), { repoRoot });
  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /missing.*toolkit-agent-control/i);
  fs.copyFileSync(path.join(repoRoot, 'repo', 'scripts', 'toolkit-agent-control.cjs'), path.join(cache, 'repo', 'scripts', 'toolkit-agent-control.cjs'));
  fs.appendFileSync(path.join(cache, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), ' ');
  state = setup.evaluateClaudeToolkitPluginState(installedList({ installPath: cache }), { repoRoot });
  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /stale.*toolkit-local-bridge/i);
  fs.rmSync(path.join(cache, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), { force: true });
  state = setup.evaluateClaudeToolkitPluginState(installedList({ installPath: cache }), { repoRoot });
  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /missing.*toolkit-local-bridge/i);
});

test('installed Claude SessionStart bridge must remain a regular cache file', { skip: process.platform === 'win32' }, (t) => {
  const cache = tmpRoot();
  for (const relPath of [
    '.claude-plugin/plugin.json', '.claude-plugin/hooks/hooks.json',
    'repo/scripts/toolkit-agent-control.cjs', 'repo/scripts/claude-process-launch.cjs',
    'repo/scripts/toolkit-claude-agent-hook.cjs', 'repo/scripts/toolkit-local-bridge.cjs',
    'repo/scripts/repo-ignore-hygiene.cjs', 'repo/scripts/repo-local-backup.cjs',
  ]) {
    const target = path.join(cache, ...relPath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, ...relPath.split('/')), target);
  }
  const bridge = path.join(cache, 'repo', 'scripts', 'toolkit-local-bridge.cjs');
  const replacement = path.join(cache, 'bridge-replacement.cjs');
  fs.copyFileSync(bridge, replacement);
  fs.unlinkSync(bridge);
  try { fs.symlinkSync(replacement, bridge); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip(`symlink creation is unavailable: ${error.code}`);
    throw error;
  }
  const state = setup.evaluateClaudeToolkitPluginState(installedList({ installPath: cache }), { repoRoot });
  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /not a regular file.*toolkit-local-bridge/i);
});
