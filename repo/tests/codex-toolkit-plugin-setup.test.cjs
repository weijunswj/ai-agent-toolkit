'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

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

// A stand-in PowerShell executable at a path without spaces: the Windows hook command writes the
// path unquoted, so setup accepts only such paths.
function fakePowerShell() {
  const file = path.join(tmpRoot(), 'powershell.exe');
  fs.writeFileSync(file, '');
  return file;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function copyPath(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) return;
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    if (path.basename(sourcePath) === 'skills') {
      try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.symlinkSync(sourcePath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
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
  const version = options.version || setup.EXPECTED_TOOLKIT_VERSION;
  const root = path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', version);
  copyPackageFingerprint(repoRoot, root);
  if (process.platform === 'win32') setup.prepareInstalledSessionStart(root);
  if (version !== setup.EXPECTED_TOOLKIT_VERSION) {
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
  const version = options.version || setup.EXPECTED_TOOLKIT_VERSION;
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

// Fake Codex CLI modelled on the qualified desktop app-server CLI 0.163.0-alpha.10.2 behaviour:
// same-source `marketplace add` is an idempotent no-op (alreadyAdded true); a same-name add from a
// different source exits 1 without changing config or cache; `marketplace remove` drops only the
// marketplace section; `plugin remove` drops the plugin section and its cache.
const FAKE_CONFIG_PREFIX = '# user-owned comment\nmodel = "user-model"\n\n[marketplaces.unrelated-local]\nsource_type = "local"\nsource = "C:/unrelated"\n\n[plugins."other@unrelated-local"]\nenabled = false\n';

function writeFakeHangingCodex(codexHome, options = {}) {
  const fakeCodexScript = path.join(codexHome, 'fake-codex.cjs');
  const expectedToolkitVersion = setup.EXPECTED_TOOLKIT_VERSION;
  const initialMarketplaceRoot = options.initialMarketplaceRoot !== undefined
    ? options.initialMarketplaceRoot
    : (options.initialInstalled ? repoRoot : '');
  writeJson(path.join(codexHome, 'state.json'), {
    marketplaceRoot: initialMarketplaceRoot,
    installed: Boolean(options.initialInstalled),
    calls: []
  });
  fs.writeFileSync(fakeCodexScript, `
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const codexHome = process.env.CODEX_HOME;
const statePath = path.join(codexHome, 'state.json');
const configPath = path.join(codexHome, 'config.toml');
const args = process.argv.slice(2);
if (args[0] === 'app-server') {
  require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
    const request = JSON.parse(line);
    if (request.method === 'initialize') process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\\n');
    if (request.method === 'config/read') process.stdout.write(JSON.stringify({ id: request.id, ...(${JSON.stringify(Boolean(options.rejectConfigLoad))} ? { error: { message: 'agents.max_concurrent_threads_per_session must be at least 1' } } : { result: { config: {} } }) }) + '\\n');
  });
  return;
}
const omitSessionStart = ${JSON.stringify(Boolean(options.omitSessionStart))};
const installDelayMs = ${JSON.stringify(options.installDelayMs || 0)};
const configPrefix = ${JSON.stringify(FAKE_CONFIG_PREFIX)};
const behaviour = ${JSON.stringify(options.behaviour || {})};

function readState() {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function renderConfig(state) {
  let text = configPrefix;
  if (state.marketplaceRoot) {
    text += '\\n[marketplaces.ai-agent-toolkit-local]\\nsource_type = ' + JSON.stringify(behaviour.configSourceType || 'local') + '\\nsource = ' + JSON.stringify(behaviour.configSourceOverride || state.marketplaceRoot) + '\\n';
    if (behaviour.duplicateConfigSection) text += '\\n[marketplaces."ai-agent-toolkit-local"]\\nsource_type = "local"\\nsource = ' + JSON.stringify(state.marketplaceRoot) + '\\n';
  }
  if (state.installed) text += '\\n[plugins."ai-agent-toolkit@ai-agent-toolkit-local"]\\nenabled = true\\n';
  fs.writeFileSync(configPath, text);
}

function writeState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\\n');
  renderConfig(state);
}

function recordCall(state) {
  state.calls.push(args.filter((arg) => arg !== '--json').join(' '));
}

function sameRoot(left, right) {
  const norm = (value) => path.resolve(String(value || '')).toLowerCase();
  return norm(left) === norm(right);
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\\n');
}

function copyPath(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) return;
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    if (path.basename(sourcePath) === 'skills') {
      try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.symlinkSync(sourcePath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
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
  const root = path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', ${JSON.stringify(expectedToolkitVersion)});
  // Publish the finished cache in one rename so a concurrent setup poll never sees a partial cache.
  const staging = root + '.staging';
  fs.rmSync(staging, { recursive: true, force: true });
  copyPackageFingerprint(repoRoot, staging);
  if (omitSessionStart) {
    fs.writeFileSync(path.join(staging, '.codex-plugin', 'hooks', 'hooks.json'), JSON.stringify({ hooks: {} }, null, 2) + '\\n');
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.renameSync(staging, root);
}

function fail(message) {
  process.stderr.write('Error: ' + message + '\\n');
  process.exit(1);
}

if (args[0] === '__render-config') {
  renderConfig(readState());
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === '--help') {
  process.stdout.write('Manage Codex plugins\\n');
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'list') {
  const state = readState();
  if (behaviour.marketplaceListFails) fail('marketplace list unavailable');
  const marketplaces = [{ name: 'unrelated-local', root: 'C:/unrelated' }];
  if (state.marketplaceRoot) {
    const entry = { name: 'ai-agent-toolkit-local', root: state.marketplaceRoot };
    if (behaviour.marketplaceListExtraKey) entry.sourceKind = 'unexpected';
    marketplaces.unshift(entry);
    if (behaviour.duplicateMarketplaceEntry) marketplaces.push({ name: 'ai-agent-toolkit-local', root: state.marketplaceRoot });
  }
  writeJson({ marketplaces });
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
  const state = readState();
  recordCall(state);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\\n');
  const requested = path.resolve(args[3]);
  if (behaviour.marketplaceAddFails) fail('marketplace add refused by fixture');
  if ((state.addFailures || 0) < (behaviour.marketplaceAddFailCount || 0)) {
    state.addFailures = (state.addFailures || 0) + 1;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\\n');
    fail('marketplace add interrupted by fixture');
  }
  if (behaviour.marketplaceAddFailsForRoot && sameRoot(requested, behaviour.marketplaceAddFailsForRoot)) fail('marketplace add refused for this source by fixture');
  if (state.marketplaceRoot && !sameRoot(state.marketplaceRoot, requested)) {
    fail("marketplace 'ai-agent-toolkit-local' is already added from a different source; remove it before adding this source");
  }
  const alreadyAdded = Boolean(state.marketplaceRoot);
  if (behaviour.marketplaceAddExitsAfterEffect) {
    state.marketplaceRoot = requested;
    writeState(state);
    fail('marketplace add lost its connection after writing config');
  }
  if (!alreadyAdded) {
    state.marketplaceRoot = behaviour.marketplaceAddBindsElsewhere || requested;
    writeState(state);
  }
  writeJson({ marketplaceName: 'ai-agent-toolkit-local', installedRoot: requested, alreadyAdded });
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'remove') {
  const state = readState();
  recordCall(state);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\\n');
  if (!state.marketplaceRoot) fail('marketplace \\x60ai-agent-toolkit-local\\x60 is not configured or installed');
  if (behaviour.marketplaceRemoveFails) fail('marketplace remove refused by fixture');
  state.marketplaceRoot = '';
  if (behaviour.marketplaceRemoveDropsPlugin) {
    state.installed = false;
    fs.rmSync(path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local'), { recursive: true, force: true });
  }
  writeState(state);
  if (behaviour.marketplaceRemoveExitsAfterEffect) fail('marketplace remove lost its connection after writing config');
  writeJson({ marketplaceName: 'ai-agent-toolkit-local', installedRoot: null });
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'list') {
  const state = readState();
  const visible = state.installed && state.marketplaceRoot;
  writeJson({
    installed: visible ? [
      {
        pluginId: 'ai-agent-toolkit@ai-agent-toolkit-local',
        name: 'ai-agent-toolkit',
        marketplaceName: 'ai-agent-toolkit-local',
        version: state.installedVersion || ${JSON.stringify(expectedToolkitVersion)},
        installed: true,
        enabled: true,
        authPolicy: 'ON_USE',
        source: {
          source: 'local',
          path: state.marketplaceRoot
        },
        marketplaceSource: {
          sourceType: 'local',
          source: behaviour.pluginMarketplaceSourceOverride || state.marketplaceRoot
        }
      }
    ] : [],
    available: []
  });
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'add') {
  const startState = readState();
  recordCall(startState);
  fs.writeFileSync(statePath, JSON.stringify(startState, null, 2) + '\\n');
  if (!startState.marketplaceRoot) fail('plugin marketplace ai-agent-toolkit-local is not configured');
  if (behaviour.pluginAddFails) fail('plugin add refused by fixture');
  const finishInstall = () => {
    const state = readState();
    installCache(state.marketplaceRoot);
    state.installed = true;
    state.installedVersion = ${JSON.stringify(expectedToolkitVersion)};
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
  recordCall(state);
  state.installed = false;
  state.removeCount = (state.removeCount || 0) + 1;
  writeState(state);
  fs.rmSync(path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit'), { recursive: true, force: true });
  writeJson({ pluginId: args[2], name: 'ai-agent-toolkit', marketplaceName: 'ai-agent-toolkit-local' });
  process.exit(0);
}

process.stderr.write('unexpected fake codex args: ' + args.join(' ') + '\\n');
process.exit(9);
`, 'utf8');
  if (options.installedVersion) {
    const statePath = path.join(codexHome, 'state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.installedVersion = options.installedVersion;
    writeJson(statePath, state);
  }
  // Keep a config a test wrote itself; otherwise start from the fake CLI's own rendering.
  if (!fs.existsSync(path.join(codexHome, 'config.toml'))) {
    const rendered = spawnSync(process.execPath, [fakeCodexScript, '__render-config'], {
      env: { ...process.env, CODEX_HOME: codexHome },
      encoding: 'utf8',
      windowsHide: true
    });
    assert.equal(rendered.status, 0, rendered.stderr);
  }
  return fakeCodexScript;
}

function readFakeState(codexHome) {
  return JSON.parse(fs.readFileSync(path.join(codexHome, 'state.json'), 'utf8'));
}

function treeDigest(root) {
  const crypto = require('node:crypto');
  const hash = crypto.createHash('sha256');
  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
  } catch {
    return 'absent';
  }
  if (rootStat.isSymbolicLink()) return `link:${fs.readlinkSync(root)}`;
  if (!rootStat.isDirectory()) return `file:${crypto.createHash('sha256').update(fs.readFileSync(root)).digest('hex')}`;
  const stack = [root];
  const entries = [];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absPath = path.join(current, entry.name);
      const relPath = path.relative(root, absPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        entries.push(`${relPath}/`);
        stack.push(absPath);
      } else if (entry.isFile()) {
        entries.push(`${relPath}:${crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex')}`);
      }
    }
  }
  hash.update(entries.sort().join('\n'));
  return hash.digest('hex');
}

function writeOldMarketplace(root) {
  writeJson(path.join(root, '.agents', 'plugins', 'marketplace.json'), {
    name: 'ai-agent-toolkit-local',
    plugins: [{ name: 'ai-agent-toolkit', source: { source: 'local', path: '.' }, policy: { installation: 'AVAILABLE', authentication: 'ON_USE' } }]
  });
  return root;
}

function runSetupWrite(codexHome, fakeCodexPath, options = {}) {
  const args = [
    path.join(repoRoot, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs'),
    '--write'
  ];
  if (options.json !== false) args.push('--json');
  args.push(
    '--repo-root',
    repoRoot,
    '--codex-home',
    codexHome,
    '--codex-cli',
    fakeCodexPath,
    ...(options.extraArgs || [])
  );
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CODEX_TOOLKIT_CODEX_PLUGIN_ADD_DEADLINE_MS: options.addDeadlineMs || '2000',
      CODEX_TOOLKIT_CODEX_PLUGIN_ADD_POLL_MS: '50'
    },
    encoding: 'utf8',
    timeout: options.timeout || 10000,
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

test('Codex Toolkit plugin source validates manifest icon assets', () => {
  assert.deepEqual(setup.validateRepoPluginSource(repoRoot), []);
});

test('Codex SessionStart verifier rejects the old direct bridge command and incomplete matchers', () => {
  const root = tmpRoot();
  const hooksPath = path.join(root, 'hooks.json');
  writeJson(hooksPath, {
    hooks: {
      SessionStart: [{
        matcher: 'startup',
        hooks: [{ type: 'command', command: 'node "${PLUGIN_ROOT}/repo/scripts/toolkit-local-bridge.cjs" --hook --sync-enabled --write --sync-source codex-plugin' }]
      }]
    }
  });
  const errors = setup.verifySessionStartHook(hooksPath).join('\n');
  assert.match(errors, /startup, resume, clear, and compact/);
  assert.match(errors, /exact portable Toolkit launcher shape/);
  assert.match(errors, /must not call toolkit-local-bridge\.cjs directly/);
});

test('Windows SessionStart preparation installs strict launcher metadata without touching Claude cache', { skip: process.platform !== 'win32' }, () => {
  const root = tmpRoot();
  const codexCache = path.join(root, 'Codex cache with spaces & brackets', 'ai-agent-toolkit');
  const claudeSentinel = path.join(root, 'claude-cache', 'sentinel.txt');
  copyPackageFingerprint(repoRoot, codexCache);
  fs.mkdirSync(path.dirname(claudeSentinel), { recursive: true });
  fs.writeFileSync(claudeSentinel, 'unchanged\n');

  const prepared = setup.prepareInstalledSessionStart(codexCache);
  assert.equal(prepared.changed, true);
  const hooksPath = path.join(codexCache, '.codex-plugin', 'hooks', 'hooks.json');
  assert.deepEqual(setup.verifySessionStartHook(hooksPath, {
    windows: true,
    powershellPath: setup.defaultWindowsPowerShellPath()
  }), []);
  assert.deepEqual(setup.verifySessionStartRuntime(codexCache), []);
  assert.equal(fs.readFileSync(claudeSentinel, 'utf8'), 'unchanged\n');
  assert.equal(setup.CACHE_FINGERPRINT_PATHS.includes(setup.SESSION_START_LAUNCHER_REL_PATH), true);
  assert.equal(setup.CACHE_FINGERPRINT_PATHS.includes(setup.SESSION_START_POWERSHELL_REL_PATH), true);
  assert.deepEqual(setup.verifyInstalledCacheFreshness(codexCache, repoRoot), []);
});

test('Windows SessionStart publishes verified runtime metadata before hook activation and reruns as a no-op', () => {
  const powershellPath = fakePowerShell();
  const cache = path.join(tmpRoot(), 'cache with spaces & metacharacters [safe]');
  copyPackageFingerprint(repoRoot, cache);
  const hooksPath = path.join(cache, '.codex-plugin', 'hooks', 'hooks.json');
  const runtimePath = path.join(cache, ...setup.SESSION_START_RUNTIME_REL_PATH.split('/'));
  const writes = [];
  const prepared = setup.prepareInstalledSessionStart(cache, {
    platform: 'win32',
    nodePath: process.execPath,
    powershellPath,
    writeFileAtomically(filePath, bytes) {
      writes.push(filePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, bytes);
    },
  });
  assert.deepEqual(writes, [runtimePath, hooksPath]);
  assert.deepEqual(prepared, { changed: true, hooksChanged: true, runtimeChanged: true });
  assert.deepEqual(setup.verifySessionStartRuntime(cache, { platform: 'win32', nodePath: process.execPath }), []);
  assert.deepEqual(setup.verifySessionStartHook(hooksPath, { windows: true, powershellPath }), []);

  const repeated = setup.prepareInstalledSessionStart(cache, {
    platform: 'win32',
    nodePath: process.execPath,
    powershellPath,
    writeFileAtomically() { assert.fail('a current SessionStart pair must not be rewritten'); },
  });
  assert.deepEqual(repeated, { changed: false, hooksChanged: false, runtimeChanged: false });
});

test('Windows SessionStart publication failures preserve one safe hook/runtime state', () => {
  const powershellPath = fakePowerShell();
  for (const failure of ['runtime', 'hook']) {
    const cache = path.join(tmpRoot(), `cache-${failure}`);
    copyPackageFingerprint(repoRoot, cache);
    const hooksPath = path.join(cache, '.codex-plugin', 'hooks', 'hooks.json');
    const runtimePath = path.join(cache, ...setup.SESSION_START_RUNTIME_REL_PATH.split('/'));
    const previousHooks = fs.readFileSync(hooksPath);
    assert.throws(() => setup.prepareInstalledSessionStart(cache, {
      platform: 'win32',
      nodePath: process.execPath,
      powershellPath,
      writeFileAtomically(filePath, bytes) {
        if (failure === 'runtime' && filePath === runtimePath) throw new Error('injected runtime publication failure');
        if (failure === 'hook' && filePath === hooksPath) throw new Error('injected hook publication failure');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, bytes);
      },
    }), new RegExp(`injected ${failure} publication failure`));
    assert.equal(fs.readFileSync(hooksPath).equals(previousHooks), true, `${failure}: prior source hook remains active`);
    if (failure === 'runtime') {
      assert.equal(fs.existsSync(runtimePath), false);
    } else {
      assert.deepEqual(setup.verifySessionStartRuntime(cache, { platform: 'win32', nodePath: process.execPath }), []);
    }
  }
});

test('stale Windows SessionStart runtime metadata is repaired and verified before hook activation', () => {
  const powershellPath = fakePowerShell();
  const cache = path.join(tmpRoot(), 'stale-runtime-cache');
  copyPackageFingerprint(repoRoot, cache);
  const hooksPath = path.join(cache, '.codex-plugin', 'hooks', 'hooks.json');
  const runtimePath = path.join(cache, ...setup.SESSION_START_RUNTIME_REL_PATH.split('/'));
  writeJson(runtimePath, { schema: 1, node_path: path.join(cache, 'missing-node.exe') });
  const writes = [];
  setup.prepareInstalledSessionStart(cache, {
    platform: 'win32',
    nodePath: process.execPath,
    powershellPath,
    writeFileAtomically(filePath, bytes) {
      writes.push(filePath);
      fs.writeFileSync(filePath, bytes);
    },
  });
  assert.deepEqual(writes, [runtimePath, hooksPath]);
  assert.deepEqual(setup.verifySessionStartRuntime(cache, { platform: 'win32', nodePath: process.execPath }), []);
});

test('Windows hooks freshness rejects every non-command cache difference after launcher normalization', { skip: process.platform !== 'win32' }, () => {
  const root = tmpRoot();
  const codexCache = path.join(root, 'codex-cache');
  copyPackageFingerprint(repoRoot, codexCache);
  setup.prepareInstalledSessionStart(codexCache);
  const hooksPath = path.join(codexCache, '.codex-plugin', 'hooks', 'hooks.json');
  const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  hooks.hooks.PostToolUse = [{
    matcher: 'Bash',
    hooks: [{ type: 'command', command: 'stale-command' }]
  }];
  writeJson(hooksPath, hooks);

  const errors = setup.verifyInstalledCacheFreshness(codexCache, repoRoot).join('\n');
  assert.match(errors, /stale.*after removing the Windows hook commands/i);
});

test('installed hooks keep the portable command and add commandWindows to both hooks; the source carries none', () => {
  const powershellPath = fakePowerShell();
  const cache = path.join(tmpRoot(), 'cache with spaces');
  copyPackageFingerprint(repoRoot, cache);
  setup.prepareInstalledSessionStart(cache, { platform: 'win32', nodePath: process.execPath, powershellPath, writeFileAtomically(filePath, bytes) { fs.writeFileSync(filePath, bytes); } });
  const installed = JSON.parse(fs.readFileSync(path.join(cache, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8'));
  const session = installed.hooks.SessionStart[0].hooks[0];
  const helper = installed.hooks.PreToolUse[0].hooks[0];
  assert.equal(session.command, setup.sourceSessionStartCommand());
  assert.equal(helper.command, setup.sourceHelperHookCommand());
  assert.equal(session.commandWindows, `${powershellPath} -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "\${PLUGIN_ROOT}/repo/scripts/toolkit-codex-session-start.ps1"`);
  assert.equal(helper.commandWindows, `${powershellPath} -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "\${PLUGIN_ROOT}/repo/scripts/toolkit-codex-helper-hook.ps1"`);
  const source = JSON.parse(fs.readFileSync(path.join(repoRoot, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8'));
  assert.equal(JSON.stringify(source).includes('commandWindows'), false);
  assert.equal(setup.CACHE_FINGERPRINT_PATHS.includes(setup.HELPER_HOOK_POWERSHELL_REL_PATH), true);
  for (const unsafe of ['C:\\Program Files\\PowerShell\\powershell.exe', 'C:\\Windows\\Power&shell.exe', 'powershell.exe']) {
    assert.throws(() => setup.windowsSessionStartCommand(unsafe), /without spaces or special characters/, unsafe);
  }
});

test('Codex Toolkit plugin setup verifier accepts active expected-version install with SessionStart cache', () => {
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
  assert.ok(state.errors.join('\n').includes(`expected version ${setup.EXPECTED_TOOLKIT_VERSION}`));

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

test('Codex Toolkit plugin setup verifier refuses implicit downgrade from newer install', () => {
  const codexHome = tmpRoot();
  writeInstalledCache(codexHome, { version: '9.9.9' });

  const state = setup.evaluateCodexToolkitPluginState(installedList({ version: '9.9.9' }), {
    codexHome,
    repoRoot
  });

  assert.equal(state.ok, false);
  assert.equal(state.refusesDowngrade, true);
  assert.match(state.errors.join('\n'), /Refusing downgrade/i);
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
          version: setup.EXPECTED_TOOLKIT_VERSION,
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
  assert.equal(state.hookTrustStatus, 'verification-unavailable');
  assert.match(state.hookTrustMessage, /Open `\/hooks` in Codex/);
  assert.match(state.hookTrustMessage, /review and trust the current Toolkit `SessionStart` hook/);
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

test('Codex Toolkit fallback does not infer hook trust from config text', () => {
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
  assert.equal(state.hookTrustStatus, 'verification-unavailable');
  assert.match(state.hookTrustMessage, /Open `\/hooks` in Codex/);
  assert.match(state.hookTrustMessage, /verification (?:is )?unavailable/i);
});

test('Codex Toolkit verification route reports bare Windows alias access denied with remediation', { skip: process.platform !== 'win32' }, async () => {
  const codexHome = tmpRoot();
  const errors = [];
  const originalError = console.error;
  console.error = (...values) => { errors.push(values.join(' ')); };
  try {
    const status = await setup.main([
      '--verify',
      '--repo-root', repoRoot,
      '--codex-home', codexHome
    ], {
      resolveCodexCommand() {
        return {
          command: '',
          failures: [setup.formatWindowsAliasFailure('codex', 'Access is denied')]
        };
      }
    });
    assert.equal(status, 2);
  } finally {
    console.error = originalError;
  }
  const message = errors.join('\n');
  assert.match(message, /WindowsApps alias|Known condition/i);
  assert.match(message, /--codex-cli/i);
  assert.match(message, /codex\.exe/i);
});

test('Codex Toolkit Windows alias detection helper recognizes Access denied fallback conditions', { skip: process.platform !== 'win32' }, () => {
  const candidate = 'codex';
  assert.equal(setup.isWindowsAppsAliasAccessDenied(candidate, 'Access is denied'), true);
  assert.equal(setup.isWindowsAppsAliasAccessDenied(candidate, 'some other error'), false);
});

test('Codex Toolkit verify-only human output keeps trust verification unavailable without config inference', () => {
  const codexHome = tmpRoot();
  writeInstalledCache(codexHome);
  writeCodexConfig(codexHome);
  const fakeCodex = writeFakeHangingCodex(codexHome);

  const result = runSetupVerify(codexHome, fakeCodex);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /verified by config\/cache fallback/i);
  assert.match(result.stdout, /Hook trust status: verification-unavailable/);
  assert.match(result.stdout, /Hook execution status: verification unavailable; open `\/hooks` in Codex/);
  assert.match(result.stdout, /\*\*Next Steps:\*\*/);
  assert.match(result.stdout, /Verify the enabled Toolkit `SessionStart` hook belongs to the installed `ai-agent-toolkit` plugin/);
  assert.match(result.stdout, /installed plugin-cache copy/);
  assert.match(result.stdout, /not the managed Git checkout/);
  assert.doesNotMatch(result.stdout, /Review and trust.*only if it runs:/);
  assert.match(result.stdout, /Hook trust verification is unavailable from supported non-interactive Codex inspection/i);
  assert.match(result.stdout, /Open `\/hooks` in Codex/i);
  assert.match(result.stdout, /review and trust the current Toolkit `SessionStart` hook/i);
  assert.match(result.stdout, /applies to Codex only/i);
  assert.match(result.stdout, /Claude Code does not need Codex hook approval/i);
  assert.match(result.stdout, /Codex must not install or update Claude Code/i);
  assert.doesNotMatch(result.stdout, /Hook trust status: (?:trusted|operational)/i);
  assert.doesNotMatch(result.stdout, /pending-review/);
});

test('Codex Toolkit isolated CODEX_HOME smoke command is documented', () => {
  const bridgeDoc = fs.readFileSync(path.join(repoRoot, 'repo', 'docs', 'TOOLKIT-LOCAL-BRIDGE.md'), 'utf8');
  assert.match(bridgeDoc, /Manual Isolated CODEX_HOME Acceptance/i);
  assert.match(bridgeDoc, /CODEX_HOME=<temp>/);
  assert.match(bridgeDoc, /setup-codex-toolkit-plugin\.cjs --write --json/);
  assert.match(bridgeDoc, /polls `codex plugin list --available --json`/);
  assert.match(bridgeDoc, /did not exit cleanly/);
  assert.match(bridgeDoc, /codex plugin list --available --json/);
  assert.match(bridgeDoc, /plugins\/cache\/ai-agent-toolkit-local\/ai-agent-toolkit\/<version>/);
  assert.match(bridgeDoc, /SessionStart/);
  assert.match(bridgeDoc, /Real Codex Host UAT/i);
  assert.match(bridgeDoc, /list the branches/i);
  assert.match(bridgeDoc, /proceed without Toolkit repo-local rules/i);
  assert.match(bridgeDoc, /alter a managed block/i);
});

test('Codex Toolkit --write succeeds when plugin add installs then times out', () => {
  const codexHome = tmpRoot();
  const result = runSetupWrite(codexHome, writeFakeHangingCodex(codexHome));

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.installed, true);
  assert.equal(summary.enabled, true);
  assert.equal(summary.current, true);
  assert.equal(summary.hook_trust_status, 'pending-review');
  assert.equal(summary.hook_execution_status, 'skipped until the current hook is reviewed and trusted');
  assert.match(summary.hook_trust_message, /Open `\/hooks` in Codex/);
  assert.deepEqual(summary.warnings, [
    'codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json did not exit cleanly, but installed-state verification passed'
  ]);
  assert.match(result.stderr, /WARN: codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json did not exit cleanly/i);
  if (process.platform === 'win32') {
    const hooksPath = path.join(summary.cache_root, '.codex-plugin', 'hooks', 'hooks.json');
    assert.deepEqual(setup.verifySessionStartHook(hooksPath, {
      windows: true,
      powershellPath: setup.defaultWindowsPowerShellPath()
    }), []);
    assert.deepEqual(setup.verifySessionStartRuntime(summary.cache_root), []);
  }
});

test('Codex cache fingerprints include every new installed setup dependency and reject missing or stale bytes', () => {
  const dependencies = [
    'repo/scripts/toolkit-agent-control.cjs',
    'repo/scripts/claude-process-launch.cjs',
    'repo/scripts/repo-ignore-hygiene.cjs',
    'repo/scripts/repo-local-backup.cjs'
  ];
  for (const relPath of dependencies) assert.equal(setup.CACHE_FINGERPRINT_PATHS.includes(relPath), true, relPath);
  for (const relPath of dependencies) {
    for (const mutation of ['missing', 'stale']) {
      const codexHome = tmpRoot();
      const cacheRoot = writeInstalledCache(codexHome);
      const target = path.join(cacheRoot, ...relPath.split('/'));
      if (mutation === 'missing') fs.unlinkSync(target);
      else fs.appendFileSync(target, '\n// stale fixture\n');
      const errors = setup.verifyInstalledCacheFreshness(cacheRoot, repoRoot).join('\n');
      assert.match(errors, mutation === 'missing' ? /missing repo file/i : /stale for repo file/i, `${mutation}: ${relPath}`);
      assert.equal(errors.includes(relPath), true, `${mutation}: ${relPath}`);
    }
  }
});

test('Codex Toolkit --write human output reports the changed hook with JSON-aligned pending review state', () => {
  const jsonHome = tmpRoot();
  const jsonResult = runSetupWrite(jsonHome, writeFakeHangingCodex(jsonHome));
  assert.equal(jsonResult.status, 0, `${jsonResult.stdout}\n${jsonResult.stderr}`);
  const summary = JSON.parse(jsonResult.stdout);

  const humanHome = tmpRoot();
  const humanResult = runSetupWrite(humanHome, writeFakeHangingCodex(humanHome), { json: false });

  assert.equal(humanResult.status, 0, `${humanResult.stdout}\n${humanResult.stderr}`);
  assert.equal(summary.hook_trust_status, 'pending-review');
  assert.equal(summary.hook_execution_status, 'skipped until the current hook is reviewed and trusted');
  assert.match(humanResult.stdout, new RegExp(`Hook trust status: ${summary.hook_trust_status}`));
  assert.match(humanResult.stdout, new RegExp(`Hook execution status: ${summary.hook_execution_status}`));
  assert.match(humanResult.stdout, /Open `\/hooks` in Codex/);
  assert.match(humanResult.stdout, /exact current Toolkit `SessionStart` hook must be reviewed and trusted/);
  assert.match(humanResult.stdout, /Codex skips the hook until it is trusted/);
  assert.doesNotMatch(humanResult.stdout, /Hook trust status: verification-unavailable/);
});

test('Codex Toolkit --write refreshes same-version stale cache by removing before reinstall', () => {
  const codexHome = tmpRoot();
  const staleRoot = writeInstalledCache(codexHome, { staleBridgeScript: true });
  fs.appendFileSync(path.join(staleRoot, 'repo', 'scripts', 'toolkit-agent-control.cjs'), '\n// stale controller\n');
  const sentinel = path.join(codexHome, 'user-owned-sentinel.txt');
  fs.writeFileSync(sentinel, 'unchanged\n');
  const fakeCodex = writeFakeHangingCodex(codexHome, { initialInstalled: true });

  const result = runSetupWrite(codexHome, fakeCodex);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  const state = JSON.parse(fs.readFileSync(path.join(codexHome, 'state.json'), 'utf8'));
  assert.equal(state.removeCount, 1);
  assert.deepEqual(setup.verifyInstalledCacheFreshness(summary.cache_root, repoRoot), []);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged\n');
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
  assert.match(result.stderr, /SessionStart|config\/cache fallback requires Codex config/i);
});

function writeFakeJsonCodex(root, body) {
  const script = path.join(root, 'fake-json-codex.cjs');
  fs.writeFileSync(script, `'use strict';\n${body}\n`, 'utf8');
  return script;
}

function writeFakeCatalogueCodex(root, targetBytes) {
  return writeFakeJsonCodex(root, `
const target = ${targetBytes};
const description = 'd'.repeat(900);
const parts = [];
let size = 16;
for (let i = 0; size < target; i += 1) {
  const item = JSON.stringify({ name: 'plugin-' + i, marketplace: 'catalogue', description });
  parts.push(item);
  size += item.length + 1;
}
process.stdout.write('{"available":[' + parts.join(',') + ']}');
`);
}

const OBSERVED_CATALOGUE_BYTES = Math.ceil(3.08 * 1024 * 1024);
const LIST_ARGS = ['plugin', 'list', '--json', '--available'];

test('Codex JSON runner parses a real-size plugin catalogue that overflows the spawnSync default buffer', () => {
  const fakeCodex = writeFakeCatalogueCodex(tmpRoot(), OBSERVED_CATALOGUE_BYTES);

  // Default-buffer regression: this fixture must still overflow Node's 1 MiB default.
  const unbounded = spawnSync(process.execPath, [fakeCodex, ...LIST_ARGS], { encoding: 'utf8', windowsHide: true });
  assert.equal(unbounded.error && unbounded.error.code, 'ENOBUFS');
  assert.ok(setup.CODEX_JSON_MAX_OUTPUT_BYTES > OBSERVED_CATALOGUE_BYTES);

  const parsed = setup.runCodexJson(fakeCodex, LIST_ARGS);
  assert.ok(JSON.stringify(parsed).length >= OBSERVED_CATALOGUE_BYTES);
  assert.equal(parsed.available[0].name, 'plugin-0');

  const inspected = setup.inspectCodexPluginList({ resolveCodexCommand: () => ({ command: fakeCodex, failures: [] }) });
  assert.equal(inspected.ok, true);
  assert.deepEqual(inspected.errors, []);
  assert.equal(inspected.pluginList.available.length, parsed.available.length);
});

test('Codex JSON runner rejects output above the bound without echoing the catalogue', () => {
  const fakeCodex = writeFakeCatalogueCodex(tmpRoot(), setup.CODEX_JSON_MAX_OUTPUT_BYTES + 64 * 1024);

  assert.throws(
    () => setup.runCodexJson(fakeCodex, LIST_ARGS),
    (error) => {
      assert.equal(error.message, 'codex plugin list --json --available output exceeded the 32 MiB limit');
      return true;
    }
  );
  const inspected = setup.inspectCodexPluginList({ resolveCodexCommand: () => ({ command: fakeCodex, failures: [] }) });
  assert.equal(inspected.ok, false);
  assert.deepEqual(inspected.errors, ['Codex CLI plugin inspection failed; current installed plugin state cannot be proven']);
});

test('Codex JSON runner keeps small-output, empty, failing and invalid JSON command behaviour', () => {
  const root = tmpRoot();
  const small = writeFakeJsonCodex(fs.mkdtempSync(path.join(root, 'small-')), `process.stdout.write('{"ok":true}\\n');`);
  assert.deepEqual(setup.runCodexJson(small, ['plugin', 'marketplace', 'add', root, '--json']), { ok: true });

  const empty = writeFakeJsonCodex(fs.mkdtempSync(path.join(root, 'empty-')), '');
  assert.deepEqual(setup.runCodexJson(empty, ['plugin', 'remove', 'ai-agent-toolkit@ai-agent-toolkit-local', '--json']), {});

  const failing = writeFakeJsonCodex(fs.mkdtempSync(path.join(root, 'failing-')), `process.stderr.write('remove refused'); process.exit(3);`);
  assert.throws(
    () => setup.runCodexJson(failing, ['plugin', 'remove', 'ai-agent-toolkit@ai-agent-toolkit-local', '--json']),
    /^Error: codex plugin remove ai-agent-toolkit@ai-agent-toolkit-local --json failed: remove refused$/
  );

  const invalid = writeFakeJsonCodex(fs.mkdtempSync(path.join(root, 'invalid-')), `process.stdout.write('not json');`);
  assert.throws(
    () => setup.runCodexJson(invalid, LIST_ARGS),
    /codex plugin list --json --available returned invalid JSON:/
  );
});

// Marketplace-source binding safety: every destructive plugin or cache effect requires a positive,
// independently read binding of ai-agent-toolkit-local to the requested source.

const PLUGIN_REMOVE_CALL = 'plugin remove ai-agent-toolkit@ai-agent-toolkit-local';
const PLUGIN_ADD_CALL = 'plugin add ai-agent-toolkit@ai-agent-toolkit-local';

function bindingScenario(options = {}) {
  const codexHome = tmpRoot();
  const cacheBase = path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local');
  if (options.installed || options.cacheOnly) {
    const cacheRoot = writeInstalledCache(codexHome, { version: options.installedVersion });
    if (options.staleCache) fs.appendFileSync(path.join(cacheRoot, 'repo', 'scripts', 'toolkit-agent-control.cjs'), '\n// stale cache\n');
  }
  const sentinel = path.join(codexHome, 'user-owned-sentinel.txt');
  fs.writeFileSync(sentinel, 'unchanged\n');
  const fakeCodex = writeFakeHangingCodex(codexHome, {
    initialInstalled: Boolean(options.installed),
    initialMarketplaceRoot: options.marketplaceRoot,
    installedVersion: options.installedVersion,
    behaviour: options.behaviour
  });
  const configPath = path.join(codexHome, 'config.toml');
  if (options.prepare) options.prepare({ codexHome, cacheBase, configPath });
  return {
    codexHome,
    fakeCodex,
    configPath,
    cacheBase,
    sentinel,
    cacheBefore: treeDigest(cacheBase),
    configBefore: fs.readFileSync(configPath, 'utf8'),
    run(extraArgs = []) {
      return runSetupWrite(codexHome, fakeCodex, { extraArgs });
    },
    calls() {
      return readFakeState(codexHome).calls;
    },
    journal() {
      const journalPath = setup.setupJournalPath(codexHome);
      return fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath, 'utf8')) : null;
    }
  };
}

function assertNoEffects(scenario, result, pattern) {
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  if (pattern) assert.match(result.stderr, pattern);
  assert.deepEqual(scenario.calls(), []);
  assert.equal(treeDigest(scenario.cacheBase), scenario.cacheBefore, 'plugin cache must be byte-identical');
  assert.equal(fs.readFileSync(scenario.configPath, 'utf8'), scenario.configBefore, 'Codex config must be byte-identical');
  assert.equal(fs.readFileSync(scenario.sentinel, 'utf8'), 'unchanged\n');
  assert.equal(scenario.journal(), null, 'no setup journal is written before a native mutation starts');
}

test('source mismatch causes zero marketplace, plugin removal and cache effects', () => {
  const oldRoot = writeOldMarketplace(tmpRoot());
  const scenario = bindingScenario({ installed: true, installedVersion: '2.10.12', marketplaceRoot: oldRoot });
  const result = scenario.run();
  assertNoEffects(scenario, result, /already bound to a different source/i);
  assert.match(result.stderr, /No marketplace, plugin or cache changes were made/i);
  assert.match(result.stderr, /--rebind-marketplace-from/);
});

test('same-version stale cache under a different marketplace source is never removed', () => {
  const oldRoot = writeOldMarketplace(tmpRoot());
  const scenario = bindingScenario({ installed: true, staleCache: true, marketplaceRoot: oldRoot });
  assertNoEffects(scenario, scenario.run(), /already bound to a different source/i);
});

test('rebind authority naming a different current source fails before any effect', () => {
  const oldRoot = writeOldMarketplace(tmpRoot());
  const wrongRoot = writeOldMarketplace(tmpRoot());
  const scenario = bindingScenario({ installed: true, installedVersion: '2.10.12', marketplaceRoot: oldRoot });
  assertNoEffects(scenario, scenario.run(['--rebind-marketplace-from', wrongRoot]), /does not match the current marketplace source/i);
});

test('rebind refuses when the current source cannot serve as a rollback target', () => {
  const missingOldRoot = path.join(tmpRoot(), 'deleted-checkout');
  const scenario = bindingScenario({ installed: true, installedVersion: '2.10.12', marketplaceRoot: missingOldRoot });
  assertNoEffects(scenario, scenario.run(['--rebind-marketplace-from', missingOldRoot]), /rollback target/i);
});

test('rebind authority is rejected when the marketplace is already bound or absent', () => {
  const oldRoot = writeOldMarketplace(tmpRoot());
  const bound = bindingScenario({ installed: true, staleCache: true });
  assertNoEffects(bound, bound.run(['--rebind-marketplace-from', oldRoot]), /only applies when the marketplace is bound to a different source/i);
  const absent = bindingScenario({ marketplaceRoot: '' });
  assertNoEffects(absent, absent.run(['--rebind-marketplace-from', oldRoot]), /only applies when the marketplace is bound to a different source/i);
});

for (const [label, behaviour, pattern] of [
  ['native marketplace list fails', { marketplaceListFails: true }, /marketplace list --json failed/i],
  ['native marketplace list reports unexpected metadata', { marketplaceListExtraKey: true }, /unexpected native metadata/i],
  ['native marketplace list reports a duplicate identity', { duplicateMarketplaceEntry: true }, /ambiguous/i],
  ['config readback has duplicate marketplace sections', { duplicateConfigSection: true }, /ambiguous/i],
  ['config readback disagrees with the native source', { configSourceOverride: 'C:/somewhere-else' }, /config readback .*does not match/i],
  ['config readback reports an unsupported source type', { configSourceType: 'git' }, /unsupported source type/i],
  ['installed plugin reports a different marketplace source', { pluginMarketplaceSourceOverride: 'C:/somewhere-else' }, /installed plugin marketplace source/i]
]) {
  test(`unverifiable binding (${label}) causes zero plugin removals and cache writes`, () => {
    const scenario = bindingScenario({ installed: true, staleCache: true, behaviour });
    assertNoEffects(scenario, scenario.run(), pattern);
  });
}

test('a refused marketplace add for an absent marketplace stops before plugin installation', () => {
  const scenario = bindingScenario({ marketplaceRoot: '', behaviour: { marketplaceAddFails: true } });
  const result = scenario.run();
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(scenario.calls(), [`plugin marketplace add ${repoRoot}`]);
  assert.equal(treeDigest(scenario.cacheBase), scenario.cacheBefore);
  assert.equal(fs.readFileSync(scenario.configPath, 'utf8'), scenario.configBefore);
  assert.equal(scenario.journal().status, 'failed-no-effect');
});

test('a marketplace add that binds an unexpected source stops before plugin installation', () => {
  const elsewhere = writeOldMarketplace(tmpRoot());
  const scenario = bindingScenario({ marketplaceRoot: '', behaviour: { marketplaceAddBindsElsewhere: elsewhere } });
  const result = scenario.run();
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(scenario.calls(), [`plugin marketplace add ${repoRoot}`]);
  assert.equal(treeDigest(scenario.cacheBase), scenario.cacheBefore);
  assert.equal(scenario.journal().status, 'failed-unverified');
});

test('an ambiguous marketplace add result blocks every later retry and plugin effect', () => {
  const scenario = bindingScenario({ marketplaceRoot: '', behaviour: { marketplaceAddExitsAfterEffect: true } });
  const first = scenario.run();
  assert.equal(first.status, 1, `${first.stdout}\n${first.stderr}`);
  assert.deepEqual(scenario.calls(), [`plugin marketplace add ${repoRoot}`]);
  assert.equal(scenario.journal().status, 'failed-unverified');
  const second = scenario.run();
  assert.equal(second.status, 1, `${second.stdout}\n${second.stderr}`);
  assert.match(second.stderr, /did not finish with verified readback/i);
  assert.match(second.stderr, /Not retrying/i);
  assert.deepEqual(scenario.calls(), [`plugin marketplace add ${repoRoot}`], 'no retry after an ambiguous native result');
  assert.equal(treeDigest(scenario.cacheBase), scenario.cacheBefore);
});

test('a failed marketplace remove during rebind stops before add and plugin replacement', () => {
  const oldRoot = writeOldMarketplace(tmpRoot());
  const scenario = bindingScenario({ installed: true, installedVersion: '2.10.12', marketplaceRoot: oldRoot, behaviour: { marketplaceRemoveFails: true } });
  const result = scenario.run(['--rebind-marketplace-from', oldRoot]);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(scenario.calls(), ['plugin marketplace remove ai-agent-toolkit-local']);
  assert.equal(treeDigest(scenario.cacheBase), scenario.cacheBefore);
  assert.equal(fs.readFileSync(scenario.configPath, 'utf8'), scenario.configBefore);
  assert.equal(scenario.journal().status, 'failed-no-effect');
});

test('an ambiguous marketplace remove during rebind is never followed by add, rollback or plugin effects', () => {
  const oldRoot = writeOldMarketplace(tmpRoot());
  const scenario = bindingScenario({ installed: true, installedVersion: '2.10.12', marketplaceRoot: oldRoot, behaviour: { marketplaceRemoveExitsAfterEffect: true } });
  const result = scenario.run(['--rebind-marketplace-from', oldRoot]);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(scenario.calls(), ['plugin marketplace remove ai-agent-toolkit-local']);
  assert.equal(treeDigest(scenario.cacheBase), scenario.cacheBefore);
  const journal = scenario.journal();
  assert.equal(journal.status, 'failed-unverified');
  assert.equal(journal.rollback.marketplace_root, oldRoot);
  assert.match(result.stderr, new RegExp(`codex plugin marketplace add ${escapeForRegex(oldRoot)}`));
  const retry = scenario.run(['--rebind-marketplace-from', oldRoot]);
  assert.equal(retry.status, 1);
  assert.deepEqual(scenario.calls(), ['plugin marketplace remove ai-agent-toolkit-local']);
});

test('a failed add after rebind remove restores the exact preimage and skips plugin replacement', () => {
  const oldRoot = writeOldMarketplace(tmpRoot());
  const scenario = bindingScenario({ installed: true, installedVersion: '2.10.12', marketplaceRoot: oldRoot, behaviour: { marketplaceAddFailsForRoot: repoRoot } });
  const result = scenario.run(['--rebind-marketplace-from', oldRoot]);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(scenario.calls(), [
    'plugin marketplace remove ai-agent-toolkit-local',
    `plugin marketplace add ${repoRoot}`,
    `plugin marketplace add ${oldRoot}`
  ]);
  assert.equal(treeDigest(scenario.cacheBase), scenario.cacheBefore);
  assert.equal(fs.readFileSync(scenario.configPath, 'utf8'), scenario.configBefore);
  assert.equal(scenario.journal().status, 'rolled-back');
  assert.match(result.stderr, /restored the previous marketplace source/i);
});

test('already-correct registration performs no marketplace add and no effects when current', () => {
  const scenario = bindingScenario({ installed: true });
  const result = scenario.run();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(scenario.calls(), []);
  assert.equal(treeDigest(scenario.cacheBase), scenario.cacheBefore);
  assert.equal(fs.readFileSync(scenario.configPath, 'utf8'), scenario.configBefore);
  assert.equal(JSON.parse(result.stdout).marketplace_transition, 'none');
});

test('already-correct registration replaces a stale cache exactly once without a duplicate add', () => {
  const scenario = bindingScenario({ installed: true, staleCache: true });
  const first = scenario.run();
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.deepEqual(scenario.calls(), [PLUGIN_REMOVE_CALL, PLUGIN_ADD_CALL]);
  const second = scenario.run();
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.deepEqual(scenario.calls(), [PLUGIN_REMOVE_CALL, PLUGIN_ADD_CALL], 'idempotent replay adds no effects');
});

test('exactly one permitted plugin replacement succeeds under a positively verified binding', () => {
  const scenario = bindingScenario({ installed: true, installedVersion: '2.10.12' });
  const result = scenario.run();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(scenario.calls(), [PLUGIN_REMOVE_CALL, PLUGIN_ADD_CALL]);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.version, setup.EXPECTED_TOOLKIT_VERSION);
  assert.deepEqual(setup.verifyInstalledCacheFreshness(summary.cache_root, repoRoot), []);
  assert.equal(fs.readFileSync(scenario.configPath, 'utf8').startsWith(FAKE_CONFIG_PREFIX), true, 'unrelated config is preserved');
  assert.equal(fs.readFileSync(scenario.sentinel, 'utf8'), 'unchanged\n');
  assert.equal(scenario.journal().status, 'completed');
});

test('gated rebind performs one marketplace transition and one plugin replacement with readback', () => {
  const oldRoot = writeOldMarketplace(tmpRoot());
  const scenario = bindingScenario({ installed: true, installedVersion: '2.10.12', marketplaceRoot: oldRoot });
  const result = scenario.run(['--rebind-marketplace-from', oldRoot]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(scenario.calls(), [
    'plugin marketplace remove ai-agent-toolkit-local',
    `plugin marketplace add ${repoRoot}`,
    PLUGIN_REMOVE_CALL,
    PLUGIN_ADD_CALL
  ]);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.marketplace_transition, 'rebound');
  assert.equal(fs.readFileSync(scenario.configPath, 'utf8').startsWith(FAKE_CONFIG_PREFIX), true);
  const journal = scenario.journal();
  assert.equal(journal.status, 'completed');
  assert.equal(journal.rollback.marketplace_root, oldRoot);
  const replay = scenario.run(['--rebind-marketplace-from', oldRoot]);
  assert.equal(replay.status, 1, 'a replayed rebind authority is refused once the binding is current');
  assert.equal(scenario.calls().length, 4);
});

test('a failed plugin add after verified removal preserves rollback state and unrelated content', () => {
  const scenario = bindingScenario({ installed: true, installedVersion: '2.10.12', behaviour: { pluginAddFails: true } });
  const result = scenario.run();
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(scenario.calls(), [PLUGIN_REMOVE_CALL, PLUGIN_ADD_CALL]);
  const journal = scenario.journal();
  assert.equal(journal.status, 'failed-unverified');
  assert.equal(journal.preimage.installed_version, '2.10.12');
  assert.equal(journal.preimage.marketplace_root, repoRoot);
  assert.equal(fs.readFileSync(scenario.configPath, 'utf8').startsWith(FAKE_CONFIG_PREFIX), true);
  assert.equal(fs.readFileSync(scenario.sentinel, 'utf8'), 'unchanged\n');
  const retry = scenario.run();
  assert.equal(retry.status, 1);
  assert.match(retry.stderr, /did not finish with verified readback/i);
  assert.deepEqual(scenario.calls(), [PLUGIN_REMOVE_CALL, PLUGIN_ADD_CALL], 'no automatic retry after a failed replacement');
});

test('plugin removal is never selected without a positively bound marketplace source', () => {
  const state = { installed: { pluginId: 'ai-agent-toolkit@ai-agent-toolkit-local' } };
  for (const status of ['absent', 'mismatch', 'ambiguous', 'unverifiable', undefined]) {
    assert.equal(setup.shouldRemoveBeforeInstall(state, { status }), false, String(status));
  }
  assert.equal(setup.shouldRemoveBeforeInstall(state, { status: 'bound' }), true);
  assert.equal(setup.shouldRemoveBeforeInstall({ installed: null }, { status: 'bound' }), false);
});

// A missing marketplace is a fresh install only when no Toolkit state survives. Leftover plugin config
// (enabled or disabled), an installed record or any retained cache means an earlier install exists,
// and the native plugin list hides that plugin once its marketplace is gone.
const ORPHANED_STATE = /is not configured, but this Codex home still holds Toolkit state/i;

function disableToolkitPlugin({ configPath }) {
  const text = fs.readFileSync(configPath, 'utf8');
  const disabled = text.replace(/(\[plugins\."ai-agent-toolkit@ai-agent-toolkit-local"\]\r?\n)enabled = true/, '$1enabled = false');
  assert.notEqual(disabled, text);
  fs.writeFileSync(configPath, disabled);
}

function nativeInstalledList(scenario) {
  const listed = spawnSync(process.execPath, [scenario.fakeCodex, 'plugin', 'list', '--json', '--available'], {
    env: { ...process.env, CODEX_HOME: scenario.codexHome },
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(listed.status, 0, listed.stderr);
  return JSON.parse(listed.stdout).installed;
}

function placeAtCacheBase(cacheBase, create) {
  fs.mkdirSync(path.dirname(cacheBase), { recursive: true });
  create(cacheBase);
}

for (const [label, options] of [
  ['enabled plugin config and old cache', { installed: true, installedVersion: '2.10.12' }],
  ['disabled plugin config and old cache', { installed: true, installedVersion: '2.10.12', prepare: disableToolkitPlugin }],
  ['disabled plugin config without cache', { prepare: ({ configPath }) => fs.appendFileSync(configPath, '\n[plugins."ai-agent-toolkit@ai-agent-toolkit-local"]\nenabled = false\n') }],
  ['old versioned cache only', { cacheOnly: true, installedVersion: '2.10.12' }],
  ['same-version stale cache only', { cacheOnly: true, staleCache: true }],
  ['Toolkit cache path is a file', { prepare: ({ cacheBase }) => placeAtCacheBase(cacheBase, (target) => fs.writeFileSync(target, 'not a directory\n')) }],
  ['Toolkit cache path is a link', { prepare: ({ cacheBase }) => placeAtCacheBase(cacheBase, (target) => fs.symlinkSync(writeOldMarketplace(tmpRoot()), target, process.platform === 'win32' ? 'junction' : 'dir')) }]
]) {
  test(`absent marketplace with leftover Toolkit state (${label}) stops with zero effects`, () => {
    const scenario = bindingScenario({ marketplaceRoot: '', ...options });
    assert.deepEqual(nativeInstalledList(scenario), [], 'the native plugin list omits a plugin whose marketplace is gone');
    const result = scenario.run();
    assertNoEffects(scenario, result, ORPHANED_STATE);
    assert.match(result.stderr, /No marketplace, plugin or cache changes were made/i);
    assert.match(result.stderr, /codex plugin marketplace add <previous-source>/);
  });
}

test('a truly fresh Codex home adds the marketplace once and installs once', () => {
  // An empty Toolkit cache directory holds no Toolkit state.
  const scenario = bindingScenario({ marketplaceRoot: '', prepare: ({ cacheBase }) => fs.mkdirSync(cacheBase, { recursive: true }) });
  const result = scenario.run();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(scenario.calls(), [`plugin marketplace add ${repoRoot}`, PLUGIN_ADD_CALL]);
  assert.equal(JSON.parse(result.stdout).marketplace_transition, 'added');
  assert.equal(scenario.journal().status, 'completed');
  const replay = scenario.run();
  assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
  assert.equal(JSON.parse(replay.stdout).marketplace_transition, 'none');
  assert.equal(scenario.calls().length, 2, 'a replay on the fresh install adds nothing');
});

test('a rebind whose marketplace remove also changes the plugin or cache stops before add', () => {
  const oldRoot = writeOldMarketplace(tmpRoot());
  const scenario = bindingScenario({ installed: true, installedVersion: '2.10.12', marketplaceRoot: oldRoot, behaviour: { marketplaceRemoveDropsPlugin: true } });
  const result = scenario.run(['--rebind-marketplace-from', oldRoot]);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(scenario.calls(), ['plugin marketplace remove ai-agent-toolkit-local']);
  assert.match(result.stderr, /changed the Toolkit plugin config or cache/i);
  assert.match(result.stderr, new RegExp(`codex plugin marketplace add ${escapeForRegex(oldRoot)}`));
  const journal = scenario.journal();
  assert.equal(journal.status, 'failed-unverified');
  assert.equal(journal.rollback.marketplace_root, oldRoot);
});

test('the gated rebind accepts its own verified intermediate absence exactly once', () => {
  const oldRoot = writeOldMarketplace(tmpRoot());
  const scenario = bindingScenario({ installed: true, installedVersion: '2.10.12', marketplaceRoot: oldRoot });
  const result = scenario.run(['--rebind-marketplace-from', oldRoot]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const journal = scenario.journal();
  assert.deepEqual(journal.steps, ['marketplace-remove', 'marketplace-add', 'marketplace-rebound', 'plugin-replacement']);
  assert.match(journal.rollback.residue_sha256, /^[0-9a-f]{64}$/);
  assert.equal(journal.status, 'completed');
});

test('deleting an unresolved rebind journal never permits a replay over the leftover plugin and cache', () => {
  const oldRoot = writeOldMarketplace(tmpRoot());
  const scenario = bindingScenario({ installed: true, installedVersion: '2.10.12', marketplaceRoot: oldRoot, behaviour: { marketplaceAddFailCount: 2 } });
  const interrupted = [
    'plugin marketplace remove ai-agent-toolkit-local',
    `plugin marketplace add ${repoRoot}`,
    `plugin marketplace add ${oldRoot}`
  ];
  const first = scenario.run(['--rebind-marketplace-from', oldRoot]);
  assert.equal(first.status, 1, `${first.stdout}\n${first.stderr}`);
  assert.deepEqual(scenario.calls(), interrupted);
  assert.equal(scenario.journal().status, 'failed-unverified');
  assert.equal(scenario.journal().rollback.marketplace_root, oldRoot);
  assert.equal(treeDigest(scenario.cacheBase), scenario.cacheBefore, 'the failed rebind left the old cache in place');
  const configAfterFailure = fs.readFileSync(scenario.configPath, 'utf8');

  const blocked = scenario.run();
  assert.equal(blocked.status, 1, `${blocked.stdout}\n${blocked.stderr}`);
  assert.match(blocked.stderr, /did not finish with verified readback/i);
  assert.match(blocked.stderr, new RegExp(`codex plugin marketplace add ${escapeForRegex(oldRoot)}`));
  assert.match(blocked.stderr, /Deleting or moving the journal does not authori[sz]e/i);
  assert.match(blocked.stderr, /keep it as recovery evidence/i);
  assert.doesNotMatch(blocked.stderr, /then remove .*journal/i);
  assert.deepEqual(scenario.calls(), interrupted);

  fs.rmSync(setup.setupJournalPath(scenario.codexHome));
  for (const extraArgs of [[], ['--rebind-marketplace-from', oldRoot]]) {
    const replay = scenario.run(extraArgs);
    assert.equal(replay.status, 1, `${replay.stdout}\n${replay.stderr}`);
    if (!extraArgs.length) assert.match(replay.stderr, ORPHANED_STATE);
    assert.deepEqual(scenario.calls(), interrupted, 'no native marketplace or plugin call after the journal was deleted');
    assert.equal(treeDigest(scenario.cacheBase), scenario.cacheBefore, 'the old cache is preserved byte for byte');
    assert.equal(fs.readFileSync(scenario.configPath, 'utf8'), configAfterFailure);
    assert.equal(scenario.journal(), null, 'no new setup journal is written');
  }
});

function escapeForRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Opt-in qualification against a real Codex CLI. Set CODEX_TOOLKIT_REAL_CODEX_CLI to the exact
// executable. It runs only against a fresh temporary CODEX_HOME and first proves the CLI honours it.
const REAL_CODEX_CLI = process.env.CODEX_TOOLKIT_REAL_CODEX_CLI || '';
const REAL_RUN = { timeout: 300000, addDeadlineMs: '240000' };

test('real Codex CLI: mismatch is refused with no effects, then the gated rebind replaces once', { skip: !REAL_CODEX_CLI && 'set CODEX_TOOLKIT_REAL_CODEX_CLI to qualify a real Codex CLI', timeout: 600000 }, () => {
  const codexHome = tmpRoot();
  const env = { ...process.env, CODEX_HOME: codexHome };
  const real = (args) => spawnSync(REAL_CODEX_CLI, args, { env, encoding: 'utf8', timeout: 300000, windowsHide: true, maxBuffer: setup.CODEX_JSON_MAX_OUTPUT_BYTES });
  const json = (args) => {
    const result = real([...args, '--json']);
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(json(['plugin', 'marketplace', 'list']), { marketplaces: [] }, 'the CLI must honour the fresh CODEX_HOME');

  const oldRoot = writeOldMarketplace(tmpRoot());
  writeJson(path.join(oldRoot, '.codex-plugin', 'plugin.json'), { name: 'ai-agent-toolkit', version: '2.10.12', description: 'previous generation fixture' });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), '# user-owned comment\nmodel = "user-model"\n', 'utf8');
  json(['plugin', 'marketplace', 'add', oldRoot]);
  assert.equal(json(['plugin', 'add', 'ai-agent-toolkit@ai-agent-toolkit-local']).version, '2.10.12');
  assert.match(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'), /^# user-owned comment\nmodel = "user-model"\n/);

  const cacheBase = path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local');
  const configPath = path.join(codexHome, 'config.toml');
  const configBefore = fs.readFileSync(configPath, 'utf8');
  const cacheBefore = treeDigest(cacheBase);
  const refused = runSetupWrite(codexHome, REAL_CODEX_CLI, REAL_RUN);
  assert.equal(refused.status, 1, `${refused.stdout}\n${refused.stderr}`);
  assert.match(refused.stderr, /already bound to a different source/i);
  assert.equal(fs.readFileSync(configPath, 'utf8'), configBefore);
  assert.equal(treeDigest(cacheBase), cacheBefore);
  assert.equal(fs.existsSync(setup.setupJournalPath(codexHome)), false);

  const rebound = runSetupWrite(codexHome, REAL_CODEX_CLI, { ...REAL_RUN, extraArgs: ['--rebind-marketplace-from', oldRoot] });
  assert.equal(rebound.status, 0, `${rebound.stdout}\n${rebound.stderr}`);
  const summary = JSON.parse(rebound.stdout);
  assert.equal(summary.marketplace_transition, 'rebound');
  assert.equal(summary.version, setup.EXPECTED_TOOLKIT_VERSION);
  assert.deepEqual(setup.verifyInstalledCacheFreshness(summary.cache_root, repoRoot), []);
  assert.equal(fs.existsSync(path.join(cacheBase, 'ai-agent-toolkit', '2.10.12')), false, 'exactly one replacement removed the old generation');
  assert.match(fs.readFileSync(configPath, 'utf8'), /^# user-owned comment\nmodel = "user-model"\n/);
  assert.equal(JSON.parse(fs.readFileSync(setup.setupJournalPath(codexHome), 'utf8')).status, 'completed');
  const listed = json(['plugin', 'marketplace', 'list']).marketplaces.filter((entry) => entry.name === 'ai-agent-toolkit-local');
  assert.equal(listed.length, 1);
  assert.equal(path.resolve(listed[0].root).toLowerCase(), repoRoot.toLowerCase());

  const configAfter = fs.readFileSync(configPath, 'utf8');
  const cacheAfter = treeDigest(cacheBase);
  const replay = runSetupWrite(codexHome, REAL_CODEX_CLI, REAL_RUN);
  assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
  assert.equal(JSON.parse(replay.stdout).marketplace_transition, 'none');
  assert.equal(fs.readFileSync(configPath, 'utf8'), configAfter, 'an already-correct replay changes nothing');
  assert.equal(treeDigest(cacheBase), cacheAfter);
});


test('native plugin setup restores config bytes and holds its journal when Codex rejects the final config', () => {
  const codexHome = tmpRoot();
  const fakeCodex = writeFakeHangingCodex(codexHome, { rejectConfigLoad: true });
  const file = path.join(codexHome, 'config.toml');
  const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const result = runSetupWrite(codexHome, fakeCodex, { timeout: 20000 });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /Codex rejected config.toml/);
  assert.match(result.stderr, /previous file was restored exactly|setup-created file was removed/);
  assert.match(result.stderr, /Native plugin or cache changes may remain/);
  if (before) assert.deepEqual(fs.readFileSync(file), before);
  else assert.equal(fs.existsSync(file), false);
  const journal = JSON.parse(fs.readFileSync(setup.setupJournalPath(codexHome), 'utf8'));
  assert.equal(journal.status, 'failed-unverified');
});
