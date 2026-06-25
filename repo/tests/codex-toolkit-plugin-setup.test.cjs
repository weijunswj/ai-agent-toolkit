'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const setup = require('../scripts/setup-codex-toolkit-plugin.cjs');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codex-toolkit-plugin-'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function copyPath(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) return;
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, { recursive: true });
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function copyPackageFingerprint(sourceRoot, cacheRoot) {
  for (const relPath of setup.CACHE_FINGERPRINT_PATHS) {
    copyPath(path.join(sourceRoot, ...relPath.split('/')), path.join(cacheRoot, ...relPath.split('/')));
  }
  for (const relDir of setup.CACHE_FINGERPRINT_DIRS) {
    copyPath(path.join(sourceRoot, ...relDir.split('/')), path.join(cacheRoot, ...relDir.split('/')));
  }
}

function writeInstalledCache(codexHome, options = {}) {
  const version = options.version || '2.2.4';
  const root = path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', version);
  copyPackageFingerprint(repoRoot, root);
  if (version !== '2.2.4') {
    const manifestPath = path.join(root, '.codex-plugin', 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.version = version;
    writeJson(manifestPath, manifest);
  }
  if (options.omitSessionStart) {
    writeJson(path.join(root, '.codex-plugin', 'hooks', 'hooks.json'), { hooks: {} });
  }
  if (options.staleBridgeScript) {
    fs.writeFileSync(path.join(root, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), '// stale cached bridge script\n', 'utf8');
  }
  return root;
}

function writeCodexConfig(codexHome, options = {}) {
  const trustedHookPath = path.join('.codex-plugin', 'hooks', 'hooks.json').replace(/\\/g, '/');
  const marketplaceKey = options.marketplaceKey || 'path';
  const marketplaceValue = options.marketplacePath || repoRoot.replace(/\\/g, '/');
  const lines = [
    '[plugins."ai-agent-toolkit@ai-agent-toolkit-local"]',
    `enabled = ${options.enabled === false ? 'false' : 'true'}`,
    '',
    '[marketplaces.ai-agent-toolkit-local]'
  ];
  if (!options.omitMarketplaceSource) {
    lines.push(`  ${marketplaceKey} = ${JSON.stringify(marketplaceValue)}`);
  }
  lines.push('');
  if (options.marketplaceType) {
    lines.splice(6, 0, `  type = ${JSON.stringify(options.marketplaceType)}`);
  }
  if (options.marketplaceSourceType) {
    lines.splice(6, 0, `  source_type = ${JSON.stringify(options.marketplaceSourceType)}`);
  }
  if (options.trustedHook !== false) {
    lines.push('[trusted_hooks]', `${JSON.stringify(trustedHookPath)} = true`, '');
  }
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), `${lines.join('\n')}\n`, 'utf8');
}

function installedList(options = {}) {
  const version = options.version || '2.2.4';
  return {
    installed: [
      {
        pluginId: 'ai-agent-toolkit@ai-agent-toolkit-local',
        name: 'ai-agent-toolkit',
        marketplaceName: 'ai-agent-toolkit-local',
        version,
        installed: true,
        enabled: options.enabled !== false,
        authPolicy: 'ON_USE',
        source: {
          source: 'local',
          path: repoRoot
        }
      }
    ],
    available: []
  };
}

function writeFakeHangingCodex(codexHome, options = {}) {
  const fakeCodexScript = path.join(codexHome, 'fake-codex.cjs');
  writeJson(path.join(codexHome, 'state.json'), {
    repoRoot: '',
    installed: Boolean(options.initialInstalled)
  });
  fs.writeFileSync(fakeCodexScript, `
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const codexHome = process.env.CODEX_HOME;
const statePath = path.join(codexHome, 'state.json');
const args = process.argv.slice(2);
const omitSessionStart = ${JSON.stringify(Boolean(options.omitSessionStart))};
const installDelayMs = ${JSON.stringify(options.installDelayMs || 0)};

function readState() {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function writeState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\\n');
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\\n');
}

function copyPath(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) return;
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, { recursive: true });
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function copyPackageFingerprint(repoRoot, cacheRoot) {
  const files = ${JSON.stringify(setup.CACHE_FINGERPRINT_PATHS)};
  const dirs = ${JSON.stringify(setup.CACHE_FINGERPRINT_DIRS)};
  for (const relPath of files) copyPath(path.join(repoRoot, ...relPath.split('/')), path.join(cacheRoot, ...relPath.split('/')));
  for (const relPath of dirs) copyPath(path.join(repoRoot, ...relPath.split('/')), path.join(cacheRoot, ...relPath.split('/')));
}

function installCache(repoRoot) {
  const root = path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', '2.2.4');
  fs.rmSync(root, { recursive: true, force: true });
  copyPackageFingerprint(repoRoot, root);
  if (omitSessionStart) {
    fs.writeFileSync(path.join(root, '.codex-plugin', 'hooks', 'hooks.json'), JSON.stringify({ hooks: {} }, null, 2) + '\\n');
  }
}

if (args[0] === 'plugin' && args[1] === '--help') {
  process.stdout.write('Manage Codex plugins\\n');
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
  const state = readState();
  state.repoRoot = path.resolve(args[3]);
  writeState(state);
  writeJson({ marketplaceName: 'ai-agent-toolkit-local' });
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'list') {
  const state = readState();
  writeJson({
    installed: state.installed ? [
      {
        pluginId: 'ai-agent-toolkit@ai-agent-toolkit-local',
        name: 'ai-agent-toolkit',
        marketplaceName: 'ai-agent-toolkit-local',
        version: '2.2.4',
        installed: true,
        enabled: true,
        authPolicy: 'ON_USE',
        source: {
          source: 'local',
          path: state.repoRoot
        }
      }
    ] : [],
    available: []
  });
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'add') {
  const finishInstall = () => {
    const state = readState();
    installCache(state.repoRoot);
    state.installed = true;
    writeState(state);
    process.stdout.write(JSON.stringify({ pluginId: args[2], authPolicy: 'ON_USE' }) + '\\n');
    setInterval(() => {}, 1000);
  };
  if (installDelayMs > 0) setTimeout(finishInstall, installDelayMs);
  else finishInstall();
  return;
}

if (args[0] === 'plugin' && args[1] === 'remove') {
  const state = readState();
  state.installed = false;
  state.removeCount = (state.removeCount || 0) + 1;
  writeState(state);
  fs.rmSync(path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit'), { recursive: true, force: true });
  writeJson({ pluginId: args[2] });
  process.exit(0);
}

process.stderr.write('unexpected fake codex args: ' + args.join(' ') + '\\n');
process.exit(9);
`, 'utf8');
  return fakeCodexScript;
}

function runSetupWrite(codexHome, fakeCodexPath) {
  return spawnSync(process.execPath, [
    path.join(repoRoot, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs'),
    '--write',
    '--json',
    '--repo-root',
    repoRoot,
    '--codex-home',
    codexHome,
    '--codex-cli',
    fakeCodexPath
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CODEX_TOOLKIT_CODEX_PLUGIN_ADD_DEADLINE_MS: '2000',
      CODEX_TOOLKIT_CODEX_PLUGIN_ADD_POLL_MS: '50'
    },
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true
  });
}

function runSetupVerify(codexHome, fakeCodexPath, extraEnv = {}) {
  const args = [
    path.join(repoRoot, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs'),
    '--verify',
    '--repo-root',
    repoRoot,
    '--codex-home',
    codexHome
  ];

  if (fakeCodexPath) {
    args.push('--codex-cli', fakeCodexPath);
  }

  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      ...extraEnv
    },
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true
  });
}

function writeWindowsAliasFailureCodex(dir) {
  const scriptPath = path.join(dir, 'codex.cmd');
  fs.writeFileSync(scriptPath, '@echo Access is denied\r\nexit /b 5\r\n', 'utf8');
  return scriptPath;
}

test('Codex Toolkit plugin source validates manifest icon assets', () => {
  assert.deepEqual(setup.validateRepoPluginSource(repoRoot), []);
});

test('Codex Toolkit plugin setup verifier accepts active 2.2.4 install with SessionStart cache', () => {
  const codexHome = tmpRoot();
  const cacheRoot = writeInstalledCache(codexHome);

  const state = setup.evaluateCodexToolkitPluginState(installedList(), {
    codexHome,
    repoRoot
  });

  assert.equal(state.ok, true);
  assert.equal(state.installed.enabled, true);
  assert.equal(path.resolve(state.cacheRoot), path.resolve(cacheRoot));
  assert.deepEqual(state.errors, []);
});

test('Codex Toolkit plugin setup verifier rejects stale, disabled, or hookless installs', () => {
  let codexHome = tmpRoot();
  writeInstalledCache(codexHome, { version: '2.1.0' });
  let state = setup.evaluateCodexToolkitPluginState(installedList({ version: '2.1.0' }), {
    codexHome,
    repoRoot
  });
  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /expected version 2\.2\.4/i);

  codexHome = tmpRoot();
  writeInstalledCache(codexHome);
  state = setup.evaluateCodexToolkitPluginState(installedList({ enabled: false }), {
    codexHome,
    repoRoot
  });
  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /not enabled/i);

  codexHome = tmpRoot();
  writeInstalledCache(codexHome, { omitSessionStart: true });
  state = setup.evaluateCodexToolkitPluginState(installedList(), {
    codexHome,
    repoRoot
  });
  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /SessionStart/i);
});

test('Codex Toolkit plugin setup verifier rejects same-version stale cache content', () => {
  const codexHome = tmpRoot();
  writeInstalledCache(codexHome, { staleBridgeScript: true });

  const state = setup.evaluateCodexToolkitPluginState(installedList(), {
    codexHome,
    repoRoot
  });

  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /cache is stale for repo file: repo\/scripts\/toolkit-local-bridge\.cjs/i);
});

test('Codex Toolkit plugin setup exposes supported local marketplace install commands only', () => {
  const commands = setup.codexToolkitInstallCommands('C:\\Users\\Example\\ai-agent-toolkit');

  assert.deepEqual(commands, [
    ['plugin', 'marketplace', 'add', 'C:\\Users\\Example\\ai-agent-toolkit', '--json'],
    ['plugin', 'add', 'ai-agent-toolkit@ai-agent-toolkit-local', '--json']
  ]);
  assert.equal(commands.flat().some((arg) => /claude/i.test(arg)), false);
});

test('Codex Toolkit marketplace wrapper avoids install-time auth for headless local installs', () => {
  assert.deepEqual(setup.validateMarketplaceWrapper({
    name: 'ai-agent-toolkit-local',
    plugins: [
      {
        name: 'ai-agent-toolkit',
        source: {
          source: 'local',
          path: '.'
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_USE'
        }
      }
    ]
  }), []);

  for (const policy of [
    { installation: 'AVAILABLE' },
    { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }
  ]) {
    const errors = setup.validateMarketplaceWrapper({
      name: 'ai-agent-toolkit-local',
      plugins: [
        {
          name: 'ai-agent-toolkit',
          source: {
            source: 'local',
            path: '.'
          },
          policy
        }
      ]
    });
    assert.match(errors.join('\n'), /must use ON_USE authentication/i);
  }
});

test('Codex Toolkit plugin setup verifier rejects install-time auth policy from Codex list output', () => {
  const codexHome = tmpRoot();
  writeInstalledCache(codexHome);

  for (const authPolicy of ['ON_INSTALL', undefined]) {
    const state = setup.evaluateCodexToolkitPluginState({
      installed: [
        {
          pluginId: 'ai-agent-toolkit@ai-agent-toolkit-local',
          name: 'ai-agent-toolkit',
          marketplaceName: 'ai-agent-toolkit-local',
          version: '2.2.4',
          installed: true,
          enabled: true,
          authPolicy,
          source: {
            source: 'local',
            path: repoRoot
          }
        }
      ],
      available: []
    }, {
      codexHome,
      repoRoot
    });

    assert.equal(state.ok, false);
    assert.match(state.errors.join('\n'), /expected authPolicy ON_USE/i);
  }
});

test('Codex Toolkit verifier falls back to config and cache when CLI list omits installed plugin', () => {
  const codexHome = tmpRoot();
  const cacheRoot = writeInstalledCache(codexHome);
  writeCodexConfig(codexHome, { trustedHook: true });

  const state = setup.evaluateCodexToolkitPluginState({ installed: [], available: [] }, {
    codexHome,
    repoRoot,
    allowConfigCacheFallback: true
  });

  assert.equal(state.ok, true);
  assert.equal(state.verificationMethod, 'config-cache-fallback');
  assert.equal(state.hookTrustStatus, 'trusted');
  assert.equal(state.installed.enabled, true);
  assert.equal(path.resolve(state.installed.source.path), path.resolve(repoRoot));
  assert.equal(path.resolve(state.cacheRoot), path.resolve(cacheRoot));
  assert.deepEqual(state.errors, []);
});

test('Codex Toolkit fallback rejects a local marketplace source outside this repo', () => {
  const codexHome = tmpRoot();
  const wrongRepo = path.join(tmpRoot(), 'old-ai-agent-toolkit');
  writeInstalledCache(codexHome);
  writeCodexConfig(codexHome, { marketplacePath: wrongRepo });

  const state = setup.evaluateCodexToolkitPluginState({ installed: [], available: [] }, {
    codexHome,
    repoRoot,
    allowConfigCacheFallback: true
  });

  assert.equal(state.ok, false);
  assert.equal(state.installed, null);
  assert.match(state.errors.join('\n'), /marketplace source path does not match this local repo/i);
  assert.match(state.errors.join('\n'), new RegExp(wrongRepo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Codex Toolkit fallback rejects local marketplace config without a source path', () => {
  const codexHome = tmpRoot();
  writeInstalledCache(codexHome);
  writeCodexConfig(codexHome, { omitMarketplaceSource: true });

  const state = setup.evaluateCodexToolkitPluginState({ installed: [], available: [] }, {
    codexHome,
    repoRoot,
    allowConfigCacheFallback: true
  });

  assert.equal(state.ok, false);
  assert.match(state.errors.join('\n'), /marketplace source path/i);
});

test('Codex Toolkit fallback accepts a verbatim-prefixed marketplace source for this repo', () => {
  const codexHome = tmpRoot();
  writeInstalledCache(codexHome);
  writeCodexConfig(codexHome, {
    marketplaceKey: 'source',
    marketplacePath: `\\\\?\\${repoRoot}`,
    marketplaceSourceType: 'local'
  });

  const state = setup.evaluateCodexToolkitPluginState({ installed: [], available: [] }, {
    codexHome,
    repoRoot,
    allowConfigCacheFallback: true
  });

  assert.equal(state.ok, true);
  assert.equal(state.verificationMethod, 'config-cache-fallback');
  assert.equal(path.resolve(state.installed.source.path), path.resolve(repoRoot));
  assert.deepEqual(state.errors, []);
});

test('Codex Toolkit fallback reports pending hook trust without rejecting the config and cache proof', () => {
  const codexHome = tmpRoot();
  writeInstalledCache(codexHome);
  writeCodexConfig(codexHome, { trustedHook: false });

  const state = setup.evaluateCodexToolkitPluginState({ installed: [], available: [] }, {
    codexHome,
    repoRoot,
    allowConfigCacheFallback: true
  });

  assert.equal(state.ok, true);
  assert.equal(state.verificationMethod, 'config-cache-fallback');
  assert.equal(state.hookTrustStatus, 'pending');
  assert.match(state.hookTrustMessage, /pending/i);
});

test('Codex Toolkit setup reports bare Windows codex access denied as a known WindowsApps fallback', { skip: process.platform !== 'win32' }, () => {
  const codexHome = tmpRoot();
  const aliasHome = tmpRoot();
  const aliasPath = writeWindowsAliasFailureCodex(aliasHome);
  const pathEnv = `${aliasHome}${path.delimiter}${process.env.PATH || ''}`;
  const result = runSetupVerify(codexHome, '', { PATH: pathEnv });

  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /WindowsApps alias|Known condition/i);
  assert.match(result.stderr, /--codex-cli/i);
  assert.match(result.stderr, /codex\.exe/i);
  assert.equal(fs.existsSync(aliasPath), true);
});

test('Codex Toolkit Windows alias detection helper recognizes Access denied fallback conditions', { skip: process.platform !== 'win32' }, () => {
  const candidate = 'codex';
  assert.equal(setup.isWindowsAppsAliasAccessDenied(candidate, 'Access is denied'), true);
  assert.equal(setup.isWindowsAppsAliasAccessDenied(candidate, 'some other error'), false);
});

test('Codex Toolkit setup output includes Codex-only hook approval next steps', () => {
  const codexHome = tmpRoot();
  writeInstalledCache(codexHome);
  writeCodexConfig(codexHome, { trustedHook: false });
  const fakeCodex = writeFakeHangingCodex(codexHome, { initialInstalled: true });
  writeJson(path.join(codexHome, 'state.json'), {
    repoRoot,
    installed: true
  });

  const result = runSetupVerify(codexHome, fakeCodex);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /\*\*Next Steps:\*\*/);
  assert.match(result.stdout, /Trust the `SessionStart` hook only if it runs:/);
  assert.match(result.stdout, /toolkit-local-bridge\.cjs" --hook --sync-enabled --write --sync-source codex-plugin/);
  assert.match(result.stdout, /Hook trust is still pending/i);
  assert.match(result.stdout, /applies to Codex only/i);
  assert.match(result.stdout, /Claude Code does not need Codex hook approval/i);
  assert.match(result.stdout, /Codex must not install or update Claude Code/i);
});

test('Codex Toolkit isolated CODEX_HOME smoke command is documented', () => {
  const bridgeDoc = fs.readFileSync(path.join(repoRoot, 'repo', 'docs', 'TOOLKIT-LOCAL-BRIDGE.md'), 'utf8');
  assert.match(bridgeDoc, /Manual Isolated CODEX_HOME Acceptance/i);
  assert.match(bridgeDoc, /CODEX_HOME=<temp>/);
  assert.match(bridgeDoc, /setup-codex-toolkit-plugin\.cjs --write --json/);
  assert.match(bridgeDoc, /polls `codex plugin list --available --json`/);
  assert.match(bridgeDoc, /did not exit cleanly/);
  assert.match(bridgeDoc, /codex plugin list --available --json/);
  assert.match(bridgeDoc, /plugins\/cache\/ai-agent-toolkit-local\/ai-agent-toolkit\/2\.2\.4/);
  assert.match(bridgeDoc, /SessionStart/);
});

test('Codex Toolkit --write succeeds when plugin add installs then times out', () => {
  const codexHome = tmpRoot();
  const result = runSetupWrite(codexHome, writeFakeHangingCodex(codexHome));

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.enabled, true);
  assert.deepEqual(summary.warnings, [
    'codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json did not exit cleanly, but installed-state verification passed'
  ]);
  assert.match(result.stderr, /WARN: codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json did not exit cleanly/i);
});

test('Codex Toolkit --write refreshes same-version stale cache by removing before reinstall', () => {
  const codexHome = tmpRoot();
  writeInstalledCache(codexHome, { staleBridgeScript: true });
  const fakeCodex = writeFakeHangingCodex(codexHome, { initialInstalled: true });

  const result = runSetupWrite(codexHome, fakeCodex);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  const state = JSON.parse(fs.readFileSync(path.join(codexHome, 'state.json'), 'utf8'));
  assert.equal(state.removeCount, 1);
  assert.deepEqual(setup.verifyInstalledCacheFreshness(summary.cache_root, repoRoot), []);
});

test('Codex Toolkit --write waits for verification when plugin add installs after timeout window', () => {
  const codexHome = tmpRoot();
  const result = runSetupWrite(codexHome, writeFakeHangingCodex(codexHome, { installDelayMs: 500 }));

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.enabled, true);
  assert.deepEqual(summary.warnings, [
    'codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json did not exit cleanly, but installed-state verification passed'
  ]);
});

test('Codex Toolkit --write fails when timed-out plugin add leaves invalid cache', () => {
  const codexHome = tmpRoot();
  const result = runSetupWrite(codexHome, writeFakeHangingCodex(codexHome, { omitSessionStart: true }));

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /plugin add ai-agent-toolkit@ai-agent-toolkit-local --json did not produce a verified install/i);
  assert.match(result.stderr, /installed-state verification failed/i);
  assert.match(result.stderr, /SessionStart/i);
});
