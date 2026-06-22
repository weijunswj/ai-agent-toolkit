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

function writeInstalledCache(codexHome, options = {}) {
  const version = options.version || '2.2.0';
  const root = path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', version);
  writeJson(path.join(root, '.codex-plugin', 'plugin.json'), {
    name: 'ai-agent-toolkit',
    version,
    hooks: './.codex-plugin/hooks/hooks.json',
    skills: './skills'
  });
  writeJson(path.join(root, '.codex-plugin', 'hooks', 'hooks.json'), {
    hooks: options.omitSessionStart ? {} : {
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node "${PLUGIN_ROOT}/repo/scripts/toolkit-local-bridge.cjs" --hook --sync-enabled --write --sync-source codex-plugin'
            }
          ]
        }
      ]
    }
  });
  return root;
}

function writeCodexConfig(codexHome, options = {}) {
  const trustedHookPath = path.join('.codex-plugin', 'hooks', 'hooks.json').replace(/\\/g, '/');
  const lines = [
    '[plugins."ai-agent-toolkit@ai-agent-toolkit-local"]',
    `enabled = ${options.enabled === false ? 'false' : 'true'}`,
    '',
    '[marketplaces.ai-agent-toolkit-local]',
    `path = ${JSON.stringify(options.marketplacePath || repoRoot.replace(/\\/g, '/'))}`,
    ''
  ];
  if (options.trustedHook !== false) {
    lines.push('[trusted_hooks]', `${JSON.stringify(trustedHookPath)} = true`, '');
  }
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), `${lines.join('\n')}\n`, 'utf8');
}

function installedList(options = {}) {
  const version = options.version || '2.2.0';
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

function installCache(repoRoot) {
  const root = path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', '2.2.0');
  fs.mkdirSync(path.join(root, '.codex-plugin', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'ai-agent-toolkit',
    version: '2.2.0',
    hooks: './.codex-plugin/hooks/hooks.json'
  }, null, 2) + '\\n');
  fs.writeFileSync(path.join(root, '.codex-plugin', 'hooks', 'hooks.json'), JSON.stringify({
    hooks: omitSessionStart ? {} : {
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node "' + repoRoot.replace(/\\\\/g, '/') + '/repo/scripts/toolkit-local-bridge.cjs" --hook --sync-enabled --write --sync-source codex-plugin'
            }
          ]
        }
      ]
    }
  }, null, 2) + '\\n');
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
        version: '2.2.0',
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
    state.installed = true;
    writeState(state);
    installCache(state.repoRoot);
    process.stdout.write(JSON.stringify({ pluginId: args[2], authPolicy: 'ON_USE' }) + '\\n');
    setInterval(() => {}, 1000);
  };
  if (installDelayMs > 0) setTimeout(finishInstall, installDelayMs);
  else finishInstall();
  return;
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

function runSetupVerify(codexHome, fakeCodexPath) {
  return spawnSync(process.execPath, [
    path.join(repoRoot, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs'),
    '--verify',
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
      CODEX_HOME: codexHome
    },
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true
  });
}

test('Codex Toolkit plugin setup verifier accepts active 2.2.0 install with SessionStart cache', () => {
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
  assert.match(state.errors.join('\n'), /expected version 2\.2\.0/i);

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
          version: '2.2.0',
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
  assert.equal(path.resolve(state.cacheRoot), path.resolve(cacheRoot));
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
  const bridgeDoc = fs.readFileSync(path.join(repoRoot, 'repo', 'docs', 'TOOLKIT-LOCAL-BRIDGE-V2.md'), 'utf8');
  assert.match(bridgeDoc, /Manual Isolated CODEX_HOME Acceptance/i);
  assert.match(bridgeDoc, /CODEX_HOME=<temp>/);
  assert.match(bridgeDoc, /setup-codex-toolkit-plugin\.cjs --write --json/);
  assert.match(bridgeDoc, /polls `codex plugin list --available --json`/);
  assert.match(bridgeDoc, /did not exit cleanly/);
  assert.match(bridgeDoc, /codex plugin list --available --json/);
  assert.match(bridgeDoc, /plugins\/cache\/ai-agent-toolkit-local\/ai-agent-toolkit\/2\.2\.0/);
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
