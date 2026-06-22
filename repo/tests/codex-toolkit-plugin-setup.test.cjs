'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
        source: {
          source: 'local',
          path: repoRoot
        }
      }
    ],
    available: []
  };
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
