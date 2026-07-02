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
  writeJson(path.join(stateDir, 'state.json'), {
    repoRoot: '',
    installed: Boolean(options.initialInstalled),
    scope: ''
  });
  const failMarketplaceAdd = Boolean(options.failMarketplaceAdd);
  const failInstall = Boolean(options.failInstall);
  const installedVersion = options.installedVersion || expectedVersion();
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
  writeState(state);
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'install') {
  if (${JSON.stringify(failInstall)}) {
    process.stderr.write('fake install failure\\n');
    process.exit(1);
  }
  const state = readState();
  state.installed = true;
  const scopeIndex = args.indexOf('--scope');
  state.scope = scopeIndex !== -1 ? args[scopeIndex + 1] : 'user';
  writeState(state);
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'list') {
  const state = readState();
  const installed = state.installed ? [
    {
      name: ${JSON.stringify(setup.TOOLKIT_PLUGIN_NAME)},
      marketplace: ${JSON.stringify(setup.TOOLKIT_MARKETPLACE_NAME)},
      version: ${JSON.stringify(installedVersion)},
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

function runSetup(mode, fakeClaudePath, extraArgs = [], options = {}) {
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
    timeout: 10000,
    windowsHide: true,
    env: options.env || process.env
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
  assert.match(state.errors.join('\n'), /Refusing downgrade/i);
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
      installPath: 'C:\\Users\\someone\\.claude\\plugins\\cache\\ai-agent-toolkit-local\\ai-agent-toolkit\\2.3.1',
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
