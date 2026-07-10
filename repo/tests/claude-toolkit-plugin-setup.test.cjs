'use strict';

const assert = require('node:assert/strict');
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
        source: { path: options.sourcePath || repoRoot }
      }
    ]
  };
}

function writeFakeClaude(stateDir, options = {}) {
  const fakeClaudeScript = path.join(stateDir, 'fake-claude.cjs');
  const initialVersion = options.installedVersion || expectedVersion();
  writeJson(path.join(stateDir, 'state.json'), {
    repoRoot: options.initialInstalled ? (options.initialRepoRoot || repoRoot) : '',
    installed: Boolean(options.initialInstalled),
    scope: options.initialInstalled ? 'user' : '',
    version: initialVersion,
    failListRemaining: options.failListTimes || 0,
    marketplaceAddCount: 0,
    installCount: 0,
    updateCount: 0,
    uninstallCount: 0
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
      source: { path: state.repoRoot }
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
  return spawnSync(process.execPath, [
    path.join(repoRoot, 'repo', 'scripts', 'setup-claude-toolkit-plugin.cjs'),
    mode,
    '--json',
    '--repo-root',
    repoRoot,
    '--claude-cli',
    fakeClaudePath,
    ...extraArgs
  ], {
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
  assert.match(state.errors.join('\n'), /source path does not match/i);
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
      installPath: 'C:\\Users\\someone\\.claude\\plugins\\cache\\ai-agent-toolkit-local\\ai-agent-toolkit\\2.3.2',
      installedAt: '2026-07-01T14:44:35.944Z',
      lastUpdated: '2026-07-01T14:44:35.944Z',
      projectPath: repoRoot
    }
  ];
  const state = setup.evaluateClaudeToolkitPluginState(realShapeList, { repoRoot });
  assert.equal(state.ok, true);
  assert.deepEqual(state.errors, []);
});

test('quoteWindowsArg quotes values with spaces and special characters, leaves plain values alone', () => {
  assert.equal(setup.quoteWindowsArg('plain'), 'plain');
  assert.equal(setup.quoteWindowsArg('ai-agent-toolkit@ai-agent-toolkit-local'), 'ai-agent-toolkit@ai-agent-toolkit-local');
  assert.equal(setup.quoteWindowsArg('C:\\Users\\a b\\repo'), '"C:\\Users\\a b\\repo"');
  assert.equal(setup.quoteWindowsArg('has "quote"'), '"has \\"quote\\""');
  assert.equal(setup.quoteWindowsArg(''), '""');
});

test('quoteWindowsArg doubles backslashes that directly precede a quote, including a trailing backslash before the closing quote', () => {
  // A single trailing backslash immediately before the closing quote must be
  // doubled -- otherwise it escapes the closing quote instead of ending the
  // argument, letting the rest of the command line leak into this argument.
  assert.equal(setup.quoteWindowsArg('C:\\Users\\a b\\'), '"C:\\Users\\a b\\\\"');
  assert.equal(setup.quoteWindowsArg('a"b\\'), '"a\\"b\\\\"');
  // Backslashes not immediately before a quote are left as literal content.
  assert.equal(setup.quoteWindowsArg('trailing\\\\'), 'trailing\\\\');
});

test('claudeSpawnParts builds a single quoted command line on win32 for a bare CLI name, preserving spaces', () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    const parts = setup.claudeSpawnParts('claude', ['plugin', 'marketplace', 'add', 'C:\\Users\\a b\\repo']);
    assert.equal(parts.shell, true);
    assert.equal(parts.args, undefined);
    assert.equal(parts.command, 'claude plugin marketplace add "C:\\Users\\a b\\repo"');
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }
});

test('claudeSpawnParts does not use a shell for a .cjs fake CLI path even on win32', () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    const fakePath = 'C:\\Users\\a b\\fake-claude.cjs';
    const parts = setup.claudeSpawnParts(fakePath, ['plugin', 'list', '--json']);
    assert.equal(parts.shell, false);
    assert.equal(parts.command, process.execPath);
    assert.deepEqual(parts.args, [fakePath, 'plugin', 'list', '--json']);
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }
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
});

test('Claude Toolkit plugin mutation deadline and poll env controls reject malformed or unsafe values', () => {
  const savedDeadline = process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS;
  const savedPoll = process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS;
  try {
    for (const bad of ['abc', '0', '-100', String(2 * 60 * 60 * 1000)]) {
      process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS = bad;
      assert.equal(setup.mutationDeadlineMs(), 120000, `deadline fallback for ${JSON.stringify(bad)}`);
    }
    for (const bad of ['abc', '0', '-5', '1']) {
      process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS = bad;
      assert.equal(setup.mutationPollMs(), 500, `poll fallback for ${JSON.stringify(bad)}`);
    }
    process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS = '2000';
    process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS = '50';
    assert.equal(setup.mutationDeadlineMs(), 2000);
    assert.equal(setup.mutationPollMs(), 50);
  } finally {
    if (savedDeadline === undefined) delete process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS;
    else process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS = savedDeadline;
    if (savedPoll === undefined) delete process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS;
    else process.env.CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS = savedPoll;
  }
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
