'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const setup = require('../scripts/setup-codex-toolkit-plugin.cjs');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

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

function writeFakeHangingCodex(codexHome, options = {}) {
  const fakeCodexScript = path.join(codexHome, 'fake-codex.cjs');
  const expectedToolkitVersion = setup.EXPECTED_TOOLKIT_VERSION;
  writeJson(path.join(codexHome, 'state.json'), {
    repoRoot: '',
    installed: Boolean(options.initialInstalled),
    marketplaceAddCount: 0,
    installCount: 0,
    removeCount: 0
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
const pluginListMode = ${JSON.stringify(options.pluginListMode || 'default')};
const pluginListPaddingBytes = ${JSON.stringify(options.pluginListPaddingBytes || 0)};
const pluginListStdout = ${JSON.stringify(options.pluginListStdout || '')};
const pluginListStderr = ${JSON.stringify(options.pluginListStderr || '')};
const pluginListExitCode = ${JSON.stringify(options.pluginListExitCode ?? 7)};

function readState() {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function writeState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\\n');
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\\n');
}

function finishOutput(exitCode) {
  process.stdout.end(() => process.exit(exitCode));
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
  fs.rmSync(root, { recursive: true, force: true });
  copyPackageFingerprint(repoRoot, root);
  if (omitSessionStart) {
    fs.writeFileSync(path.join(root, '.codex-plugin', 'hooks', 'hooks.json'), JSON.stringify({ hooks: {} }, null, 2) + '\\n');
  }
}

function writePluginList(state) {
  const pluginList = {
    installed: state.installed ? [
      {
        pluginId: 'ai-agent-toolkit@ai-agent-toolkit-local',
        name: 'ai-agent-toolkit',
        marketplaceName: 'ai-agent-toolkit-local',
        version: ${JSON.stringify(expectedToolkitVersion)},
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
  };
  if (pluginListMode === 'large-valid' || pluginListMode === 'over-limit') {
    pluginList.available.push({
      name: 'large-json-fixture',
      description: (pluginListMode === 'over-limit' ? 'OVER_LIMIT_PAYLOAD_' : 'LARGE_JSON_PAYLOAD_') + 'x'.repeat(pluginListPaddingBytes)
    });
  }
  writeJson(pluginList);
}

if (args[0] === 'plugin' && args[1] === '--help') {
  process.stdout.write('Manage Codex plugins\\n');
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
  const state = readState();
  state.repoRoot = path.resolve(args[3]);
  state.marketplaceAddCount = (state.marketplaceAddCount || 0) + 1;
  writeState(state);
  writeJson({ marketplaceName: 'ai-agent-toolkit-local' });
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'list') {
  const state = readState();
  if (pluginListMode === 'invalid-json') {
    process.stdout.write(pluginListStdout || '{"installed":');
    finishOutput(0);
    return;
  } else if (pluginListMode === 'non-zero') {
    process.stdout.write(pluginListStdout);
    process.stderr.write(pluginListStderr);
    finishOutput(pluginListExitCode);
    return;
  } else {
    writePluginList(state);
    finishOutput(0);
    return;
  }
}

if (args[0] === 'plugin' && args[1] === 'add') {
  const finishInstall = () => {
    const state = readState();
    state.installCount = (state.installCount || 0) + 1;
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
    fakeCodexPath
  );
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CODEX_TOOLKIT_CODEX_PLUGIN_ADD_DEADLINE_MS: '2000',
      CODEX_TOOLKIT_CODEX_PLUGIN_ADD_POLL_MS: '50'
    },
    encoding: 'utf8',
    timeout: 10000,
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

function readFileSnapshot(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

function snapshotFiles(filePaths) {
  return filePaths.map((filePath) => ({ filePath, bytes: readFileSnapshot(filePath) }));
}

function assertFilesUnchanged(snapshot) {
  for (const { filePath, bytes } of snapshot) {
    assert.deepEqual(readFileSnapshot(filePath), bytes, filePath);
  }
}

function createDelegatedNativeFixture(options = {}) {
  const root = tmpRoot();
  const sourceRoot = path.join(root, 'source');
  const codexHome = path.join(root, 'codex-home');
  copyPackageFingerprint(repoRoot, sourceRoot);
  copyPath(
    path.join(repoRoot, '.agents', 'plugins', 'marketplace.json'),
    path.join(sourceRoot, '.agents', 'plugins', 'marketplace.json')
  );
  fs.mkdirSync(codexHome, { recursive: true });
  const fakeCodex = path.join(root, 'fake-codex.cjs');
  const dispatchLog = path.join(root, 'dispatch.log');
  const pluginList = options.pluginList || { installed: [], available: [] };
  fs.writeFileSync(fakeCodex, [
    "'use strict';",
    "const fs = require('node:fs');",
    "fs.appendFileSync(process.env.TOOLKIT_NATIVE_DISPATCH_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');",
    `const pluginList = ${JSON.stringify(pluginList)};`,
    "if (process.argv.slice(2).join(' ') === 'plugin list --json --available') process.stdout.write(JSON.stringify(pluginList));",
    "else process.stdout.write(JSON.stringify({ ok: true }));",
    ''
  ].join('\n'));
  const phaseId = crypto.randomUUID();
  const phasePath = path.join(codexHome, `.ai-agent-toolkit-native-phase-${phaseId}.json`);
  const scriptPath = path.join(repoRoot, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs');
  const authority = {
    contract: 'toolkit.local-bridge.delegated-native-setup-authority.v1',
    parent_invocation_id: options.parentInvocationId || 'delegated-native-fixture',
    action: 'native.cache.maintenance',
    repository: sourceRoot,
    codex_home: codexHome,
    setup_source_sha256: sha256(fs.readFileSync(scriptPath)),
    source_cache_fingerprint: setup.cacheFingerprint(sourceRoot, sourceRoot, {
      normalizeWindowsSessionStart: process.platform === 'win32'
    }),
    verified_source: {
      receipt_id: sha256('delegated-native-fixture-receipt'),
      commit: '5'.repeat(40),
      tree: '6'.repeat(40),
      setup_source_sha256: sha256(fs.readFileSync(scriptPath)),
      source_manifest_digest: sha256('delegated-native-fixture-manifest')
    },
    mutation_phase_id: phaseId,
    mutation_phase_lock_path: phasePath,
    executable: path.resolve(process.execPath),
    expected_version: setup.EXPECTED_TOOLKIT_VERSION,
    env_digest: sha256(canonicalJson({ ...process.env, TOOLKIT_NATIVE_DISPATCH_LOG: dispatchLog })),
    allowed_effects: [
      'codex.command.probe', 'codex.plugin.list', 'codex.marketplace.add', 'codex.plugin.remove',
      'codex.plugin.add', 'codex.session-start.write', 'toml.structural.check'
    ]
  };
  return { root, sourceRoot, codexHome, fakeCodex, dispatchLog, phasePath, authority };
}

async function runDelegatedNativeFixture(fixture, hooks = {}) {
  const previousLog = process.env.TOOLKIT_NATIVE_DISPATCH_LOG;
  const previousCli = process.env.CODEX_TOOLKIT_CODEX_CLI;
  process.env.TOOLKIT_NATIVE_DISPATCH_LOG = fixture.dispatchLog;
  process.env.CODEX_TOOLKIT_CODEX_CLI = fixture.fakeCodex;
  fixture.authority.env_digest = sha256(canonicalJson({ ...process.env }));
  const encoded = Buffer.from(canonicalJson(fixture.authority), 'utf8').toString('base64url');
  try {
    return await setup.main([
      '--write', '--json', '--repo-root', fixture.sourceRoot, '--codex-home', fixture.codexHome,
      '--delegated-invocation-authority', encoded
    ], {
      resolveCodexCommand: () => ({ command: fixture.fakeCodex, failures: [] }),
      nativePhaseTestHooks: hooks
    });
  } finally {
    if (previousLog === undefined) delete process.env.TOOLKIT_NATIVE_DISPATCH_LOG;
    else process.env.TOOLKIT_NATIVE_DISPATCH_LOG = previousLog;
    if (previousCli === undefined) delete process.env.CODEX_TOOLKIT_CODEX_CLI;
    else process.env.CODEX_TOOLKIT_CODEX_CLI = previousCli;
  }
}

test('Codex Toolkit plugin source validates manifest icon assets', () => {
  assert.deepEqual(setup.validateRepoPluginSource(repoRoot), []);
});

test('delegated native authority CLI contract is accepted and source identity substitution fails before effects', () => {
  const root = tmpRoot();
  const codexHome = path.join(root, 'codex-home');
  fs.mkdirSync(codexHome, { recursive: true });
  const scriptPath = path.join(repoRoot, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs');
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path')),
    CODEX_HOME: codexHome,
    PATH: '',
    CODEX_TOOLKIT_CODEX_CLI: ''
  };
  const mutationPhaseId = crypto.randomUUID();
  const authority = {
    contract: 'toolkit.local-bridge.delegated-native-setup-authority.v1',
    parent_invocation_id: 'test-native-authority',
    action: 'native.cache.maintenance',
    repository: repoRoot,
    codex_home: codexHome,
    setup_source_sha256: sha256(fs.readFileSync(scriptPath)),
    source_cache_fingerprint: setup.cacheFingerprint(repoRoot, repoRoot, {
      normalizeWindowsSessionStart: process.platform === 'win32'
    }),
    verified_source: {
      receipt_id: sha256('fixture-receipt'),
      commit: '1'.repeat(40),
      tree: '2'.repeat(40),
      setup_source_sha256: sha256(fs.readFileSync(scriptPath)),
      source_manifest_digest: sha256('fixture-manifest')
    },
    mutation_phase_id: mutationPhaseId,
    mutation_phase_lock_path: path.join(codexHome, `.ai-agent-toolkit-native-phase-${mutationPhaseId}.json`),
    executable: path.resolve(process.execPath),
    expected_version: setup.EXPECTED_TOOLKIT_VERSION,
    env_digest: sha256(canonicalJson(env)),
    allowed_effects: [
      'codex.command.probe', 'codex.plugin.list', 'codex.marketplace.add', 'codex.plugin.remove',
      'codex.plugin.add', 'codex.session-start.write', 'toml.structural.check'
    ]
  };
  const invoke = (value) => spawnSync(process.execPath, [
    scriptPath, '--write', '--json', '--repo-root', repoRoot, '--codex-home', codexHome,
    '--delegated-invocation-authority', Buffer.from(canonicalJson(value), 'utf8').toString('base64url')
  ], { cwd: repoRoot, encoding: 'utf8', env, windowsHide: true, timeout: 30000 });
  const accepted = invoke(authority);
  assert.equal(accepted.status, 2);
  assert.doesNotMatch(accepted.stderr, /Unknown argument: --delegated-invocation-authority/);
  assert.match(accepted.stderr, /unsupported in this environment|No usable Codex CLI/);

  const substituted = invoke({
    ...authority,
    setup_source_sha256: '0'.repeat(64),
    verified_source: { ...authority.verified_source, setup_source_sha256: '0'.repeat(64) }
  });
  assert.equal(substituted.status, 2);
  assert.match(substituted.stderr, /setup source identity changed before child start/);
  assert.equal(fs.readdirSync(codexHome).length, 0, 'delegated phase evidence must be released and invalid authority must write nothing');
});

test('delegated native child phase revocation after one command blocks every later command and preserves replacement evidence', async () => {
  const root = tmpRoot();
  const codexHome = path.join(root, 'codex-home');
  fs.mkdirSync(codexHome, { recursive: true });
  const fakeCodex = path.join(root, 'fake-codex.cjs');
  const dispatchLog = path.join(root, 'dispatch.log');
  const phaseId = crypto.randomUUID();
  const phasePath = path.join(codexHome, `.ai-agent-toolkit-native-phase-${phaseId}.json`);
  fs.writeFileSync(fakeCodex, [
    "'use strict';",
    "const fs = require('node:fs');",
    "fs.appendFileSync(process.env.TOOLKIT_NATIVE_DISPATCH_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');",
    "fs.writeFileSync(process.env.TOOLKIT_NATIVE_PHASE_PATH, 'replacement-authority');",
    "process.stdout.write('Manage Codex plugins\\n');",
    ''
  ].join('\n'));
  const previousLog = process.env.TOOLKIT_NATIVE_DISPATCH_LOG;
  const previousPhase = process.env.TOOLKIT_NATIVE_PHASE_PATH;
  const previousCli = process.env.CODEX_TOOLKIT_CODEX_CLI;
  process.env.TOOLKIT_NATIVE_DISPATCH_LOG = dispatchLog;
  process.env.TOOLKIT_NATIVE_PHASE_PATH = phasePath;
  process.env.CODEX_TOOLKIT_CODEX_CLI = fakeCodex;
  try {
    const scriptPath = path.join(repoRoot, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs');
    const authority = {
      contract: 'toolkit.local-bridge.delegated-native-setup-authority.v1',
      parent_invocation_id: 'phase-revocation-fixture',
      action: 'native.cache.maintenance',
      repository: repoRoot,
      codex_home: codexHome,
      setup_source_sha256: sha256(fs.readFileSync(scriptPath)),
      source_cache_fingerprint: setup.cacheFingerprint(repoRoot, repoRoot, { normalizeWindowsSessionStart: process.platform === 'win32' }),
      verified_source: {
        receipt_id: sha256('phase-revocation-receipt'),
        commit: '3'.repeat(40),
        tree: '4'.repeat(40),
        setup_source_sha256: sha256(fs.readFileSync(scriptPath)),
        source_manifest_digest: sha256('phase-revocation-manifest')
      },
      mutation_phase_id: phaseId,
      mutation_phase_lock_path: phasePath,
      executable: path.resolve(process.execPath),
      expected_version: setup.EXPECTED_TOOLKIT_VERSION,
      env_digest: sha256(canonicalJson({ ...process.env })),
      allowed_effects: [
        'codex.command.probe', 'codex.plugin.list', 'codex.marketplace.add', 'codex.plugin.remove',
        'codex.plugin.add', 'codex.session-start.write', 'toml.structural.check'
      ]
    };
    const encoded = Buffer.from(canonicalJson(authority), 'utf8').toString('base64url');
    await assert.rejects(() => setup.main([
      '--write', '--json', '--repo-root', repoRoot, '--codex-home', codexHome,
      '--delegated-invocation-authority', encoded
    ]), /mutation phase lock was replaced/);
    const dispatches = fs.readFileSync(dispatchLog, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    assert.equal(dispatches.length, 1, 'phase revocation must prevent the plugin-list continuation from dispatching');
    assert.equal(fs.readFileSync(phasePath, 'utf8'), 'replacement-authority', 'replacement phase evidence must not be cleaned up');
  } finally {
    if (previousLog === undefined) delete process.env.TOOLKIT_NATIVE_DISPATCH_LOG;
    else process.env.TOOLKIT_NATIVE_DISPATCH_LOG = previousLog;
    if (previousPhase === undefined) delete process.env.TOOLKIT_NATIVE_PHASE_PATH;
    else process.env.TOOLKIT_NATIVE_PHASE_PATH = previousPhase;
    if (previousCli === undefined) delete process.env.CODEX_TOOLKIT_CODEX_CLI;
    else process.env.CODEX_TOOLKIT_CODEX_CLI = previousCli;
    fs.rmSync(phasePath, { force: true });
  }
});

test('delegated native source closure drift rejects the next marketplace effect and preserves phase evidence', async () => {
  const fixture = createDelegatedNativeFixture();
  const dependency = path.join(fixture.sourceRoot, ...setup.SESSION_START_LAUNCHER_REL_PATH.split('/'));
  let changed = false;
  const code = await runDelegatedNativeFixture(fixture, {
    afterEffect({ action }) {
      if (!changed && action === 'codex.plugin.list') {
        fs.appendFileSync(dependency, '\n// source drift after launch\n');
        changed = true;
      }
    }
  });
  assert.equal(code, 1);
  assert.equal(changed, true);
  const dispatches = fs.readFileSync(fixture.dispatchLog, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  assert.equal(dispatches.length, 1, 'source drift must reject marketplace add before dispatch');
  assert.deepEqual(JSON.parse(dispatches[0]), ['plugin', 'list', '--json', '--available']);
  assert.equal(fs.existsSync(fixture.phasePath), true, 'source drift must preserve phase evidence instead of releasing it');
  fs.rmSync(fixture.root, { recursive: true, force: true });
});

test('delegated SessionStart publication rejects intermediate ancestor replacement before write, rename, and cleanup', { skip: process.platform !== 'win32' }, async (t) => {
  for (const effectKind of ['exclusive-write', 'rename', 'cleanup']) {
    await t.test(effectKind, async () => {
      const fixture = createDelegatedNativeFixture();
      const cacheRoot = setup.cacheRootFor(fixture.codexHome);
      copyPackageFingerprint(fixture.sourceRoot, cacheRoot);
      const pluginList = {
        installed: [{
          pluginId: setup.pluginId(),
          name: setup.TOOLKIT_PLUGIN_NAME,
          marketplaceName: setup.TOOLKIT_MARKETPLACE_NAME,
          version: setup.EXPECTED_TOOLKIT_VERSION,
          installed: true,
          enabled: true,
          authPolicy: 'ON_USE',
          source: { source: 'local', path: fixture.sourceRoot }
        }],
        available: []
      };
      fs.writeFileSync(fixture.fakeCodex, fs.readFileSync(fixture.fakeCodex, 'utf8').replace(
        /const pluginList = .*?;/,
        `const pluginList = ${JSON.stringify(pluginList)};`
      ));
      const ancestor = path.join(cacheRoot, '.codex-plugin');
      const displaced = path.join(cacheRoot, '.codex-plugin-admitted');
      const redirected = path.join(fixture.root, `redirected-${effectKind}`);
      fs.mkdirSync(redirected, { recursive: true });
      let replaced = false;
      const code = await runDelegatedNativeFixture(fixture, {
        beforeEffect({ action, operands }) {
          if (!replaced && action === 'codex.session-start.write' && operands.kind === effectKind) {
            fs.renameSync(ancestor, displaced);
            fs.symlinkSync(redirected, ancestor, 'junction');
            replaced = true;
          }
        },
        afterEffect({ action, operands }) {
          if (effectKind === 'cleanup' && action === 'codex.session-start.write' && operands.kind === 'exclusive-write') {
            throw new Error('synthetic publication failure before cleanup admission');
          }
        }
      });
      assert.equal(code, 1);
      assert.equal(replaced, true);
      assert.deepEqual(fs.readdirSync(redirected), [], `${effectKind} must be rejected before redirected dispatch`);
      fs.unlinkSync(ancestor);
      fs.renameSync(displaced, ancestor);
      if (effectKind === 'rename' || effectKind === 'cleanup') {
        assert.equal(
          fs.readdirSync(ancestor).some((name) => name.includes('.tmp-')),
          true,
          'revoked rename cleanup must preserve the admitted temporary evidence'
        );
      }
      fs.rmSync(fixture.root, { recursive: true, force: true });
    });
  }
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
  assert.match(errors, /exact portable source Toolkit launcher shape/);
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
  assert.equal(setup.CACHE_FINGERPRINT_PATHS.includes('repo/scripts/toolkit-toml-structural.cjs'), true);
  assert.deepEqual(setup.verifyInstalledCacheFreshness(codexCache, repoRoot), []);
});

test('Windows SessionStart publishes verified runtime metadata before hook activation and reruns as a no-op', () => {
  const cache = path.join(tmpRoot(), 'cache with spaces & metacharacters [safe]');
  copyPackageFingerprint(repoRoot, cache);
  const hooksPath = path.join(cache, '.codex-plugin', 'hooks', 'hooks.json');
  const runtimePath = path.join(cache, ...setup.SESSION_START_RUNTIME_REL_PATH.split('/'));
  const writes = [];
  const prepared = setup.prepareInstalledSessionStart(cache, {
    platform: 'win32',
    nodePath: process.execPath,
    powershellPath: process.execPath,
    writeFileAtomically(filePath, bytes) {
      writes.push(filePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, bytes);
    },
  });
  assert.deepEqual(writes, [runtimePath, hooksPath]);
  assert.deepEqual(prepared, { changed: true, hooksChanged: true, runtimeChanged: true });
  assert.deepEqual(setup.verifySessionStartRuntime(cache, { platform: 'win32', nodePath: process.execPath }), []);
  assert.deepEqual(setup.verifySessionStartHook(hooksPath, { windows: true, powershellPath: process.execPath }), []);

  const repeated = setup.prepareInstalledSessionStart(cache, {
    platform: 'win32',
    nodePath: process.execPath,
    powershellPath: process.execPath,
    writeFileAtomically() { assert.fail('a current SessionStart pair must not be rewritten'); },
  });
  assert.deepEqual(repeated, { changed: false, hooksChanged: false, runtimeChanged: false });
});

test('Windows SessionStart publication failures preserve one safe hook/runtime state', () => {
  for (const failure of ['runtime', 'hook']) {
    const cache = path.join(tmpRoot(), `cache-${failure}`);
    copyPackageFingerprint(repoRoot, cache);
    const hooksPath = path.join(cache, '.codex-plugin', 'hooks', 'hooks.json');
    const runtimePath = path.join(cache, ...setup.SESSION_START_RUNTIME_REL_PATH.split('/'));
    const previousHooks = fs.readFileSync(hooksPath);
    assert.throws(() => setup.prepareInstalledSessionStart(cache, {
      platform: 'win32',
      nodePath: process.execPath,
      powershellPath: process.execPath,
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
  const cache = path.join(tmpRoot(), 'stale-runtime-cache');
  copyPackageFingerprint(repoRoot, cache);
  const hooksPath = path.join(cache, '.codex-plugin', 'hooks', 'hooks.json');
  const runtimePath = path.join(cache, ...setup.SESSION_START_RUNTIME_REL_PATH.split('/'));
  writeJson(runtimePath, { schema: 1, node_path: path.join(cache, 'missing-node.exe') });
  const writes = [];
  setup.prepareInstalledSessionStart(cache, {
    platform: 'win32',
    nodePath: process.execPath,
    powershellPath: process.execPath,
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
  assert.match(errors, /stale.*after normalizing the Windows SessionStart command/i);
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

test('Codex Toolkit verifier retains config and cache evidence as diagnostics when native inventory omits the plugin', () => {
  const codexHome = tmpRoot();
  const cacheRoot = writeInstalledCache(codexHome);
  writeCodexConfig(codexHome, { trustedHook: true });

  const state = setup.evaluateCodexToolkitPluginState({ installed: [], available: [] }, {
    codexHome,
    repoRoot,
    allowConfigCacheFallback: true
  });

  assert.equal(state.ok, false);
  assert.equal(state.verificationMethod, 'config-cache-diagnostics');
  assert.equal(state.installed, null);
  assert.equal(path.resolve(state.cacheRoot), path.resolve(cacheRoot));
  assert.match(state.errors.join('\n'), /native Codex installed-plugin inventory is required/i);
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

test('Codex Toolkit config inspection ignores marker-like plugin tables in strings and fails closed on ambiguous state', () => {
  const identity = setup.pluginId();
  const inBasicString = `note = \"\"\"\n[plugins.\"${identity}\"]\nenabled = true\n\"\"\"\n`;
  const inLiteralString = `note = '''\n[plugins.\"${identity}\"]\nenabled = true\n'''\n`;
  const duplicateEnabled = `[plugins.\"${identity}\"]\nenabled = true\nenabled = false\n`;
  const disabled = `[plugins.\"${identity}\"]\nenabled = false\n`;
  const malformed = `[plugins.\"${identity}\"\nenabled = true\n`;

  assert.equal(setup.inspectConfiguredPluginState(inBasicString, identity).status, 'unprovable');
  assert.equal(setup.inspectConfiguredPluginState(inLiteralString, identity).status, 'unprovable');
  assert.equal(setup.inspectConfiguredPluginState(duplicateEnabled, identity).status, 'unprovable');
  assert.equal(setup.inspectConfiguredPluginState(disabled, identity).status, 'disabled');
  assert.equal(setup.inspectConfiguredPluginState(malformed, identity).status, 'unprovable');
});

test('Codex Toolkit config proof rejects tomllib-valid escaped triple-quote fake state', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'toolkit-toml', 'escaped-triple-quote-user-content.toml'), 'utf8');
  assert.equal(setup.inspectConfiguredPluginState(text, setup.pluginId()).status, 'unprovable');
});

test('Codex Toolkit diagnostics accept a verbatim-prefixed marketplace source without manufacturing installed state', () => {
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

  assert.equal(state.ok, false);
  assert.equal(state.verificationMethod, 'config-cache-diagnostics');
  assert.equal(state.installed, null);
  assert.match(state.errors.join('\n'), /native Codex installed-plugin inventory is required/i);
  assert.doesNotMatch(state.errors.join('\n'), /marketplace source path does not match/i);
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

  assert.equal(state.ok, false);
  assert.equal(state.verificationMethod, 'config-cache-diagnostics');
  assert.equal(state.installed, null);
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

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /native Codex installed-plugin inventory is required/i);
  assert.doesNotMatch(result.stdout, /verified by config\/cache fallback/i);
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

test('Codex JSON inspection accepts valid plugin-list JSON at the observed large-response scale', () => {
  const codexHome = tmpRoot();
  writeInstalledCache(codexHome);
  const paddingBytes = 1700000;
  assert.ok(paddingBytes > 1024 * 1024);
  const fakeCodex = writeFakeHangingCodex(codexHome, {
    initialInstalled: true,
    pluginListMode: 'large-valid',
    pluginListPaddingBytes: paddingBytes
  });

  const result = runSetupVerify(codexHome, fakeCodex);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /verified by Codex CLI plugin list and cache/i);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /LARGE_JSON_PAYLOAD_/);
});

test('Codex JSON inspection rejects an over-limit response explicitly without parsing partial JSON', () => {
  const codexHome = tmpRoot();
  const fakeCodex = writeFakeHangingCodex(codexHome, {
    initialInstalled: true,
    pluginListMode: 'over-limit',
    pluginListPaddingBytes: setup.CODEX_JSON_MAX_BUFFER_BYTES
  });

  const result = runSetupVerify(codexHome, fakeCodex);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 1, output);
  assert.match(result.stderr, /excessive response/i);
  assert.match(result.stderr, new RegExp(String(setup.CODEX_JSON_MAX_BUFFER_BYTES)));
  assert.doesNotMatch(result.stderr, /returned invalid JSON/i);
  assert.doesNotMatch(output, /OVER_LIMIT_PAYLOAD_/);
});

test('Codex JSON inspection rejects invalid JSON without exposing plugin-list output', () => {
  const codexHome = tmpRoot();
  const fakeCodex = writeFakeHangingCodex(codexHome, {
    pluginListMode: 'invalid-json',
    pluginListStdout: '{"installed":["INVALID_JSON_PAYLOAD'
  });

  const result = runSetupVerify(codexHome, fakeCodex);

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /returned invalid JSON/i);
  assert.match(result.stderr, /response content was suppressed/i);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /INVALID_JSON_PAYLOAD/);
});

test('Codex JSON inspection keeps bounded stderr for non-zero exit while suppressing stdout', () => {
  const codexHome = tmpRoot();
  const fakeCodex = writeFakeHangingCodex(codexHome, {
    pluginListMode: 'non-zero',
    pluginListStdout: '{"leaked":"NON_ZERO_PLUGIN_LIST_PAYLOAD"}',
    pluginListStderr: 'bounded Codex list diagnostic\n',
    pluginListExitCode: 23
  });

  const result = runSetupVerify(codexHome, fakeCodex);

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /failed: bounded Codex list diagnostic/i);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /NON_ZERO_PLUGIN_LIST_PAYLOAD/);
});

test('Codex --write inspection failure performs zero setup, cache, hook, marketplace, install, or remove writes', () => {
  const codexHome = tmpRoot();
  const cacheRoot = writeInstalledCache(codexHome);
  const cacheMarker = path.join(cacheRoot, 'inspection-failure-cache-marker.txt');
  fs.writeFileSync(cacheMarker, 'cache unchanged\n');
  writeCodexConfig(codexHome, { trustedHook: true });
  const fakeCodex = writeFakeHangingCodex(codexHome, {
    initialInstalled: true,
    pluginListMode: 'over-limit',
    pluginListPaddingBytes: setup.CODEX_JSON_MAX_BUFFER_BYTES
  });

  const configPath = path.join(codexHome, 'config.toml');
  const manifestPath = path.join(cacheRoot, '.codex-plugin', 'plugin.json');
  const hooksPath = path.join(cacheRoot, '.codex-plugin', 'hooks', 'hooks.json');
  const runtimePath = path.join(cacheRoot, ...setup.SESSION_START_RUNTIME_REL_PATH.split('/'));
  const marketplacePath = path.join(repoRoot, ...setup.MARKETPLACE_REL_PATH.split('/'));
  const statePath = path.join(codexHome, 'state.json');
  const before = snapshotFiles([
    configPath,
    manifestPath,
    hooksPath,
    runtimePath,
    cacheMarker,
    marketplacePath,
    statePath
  ]);

  const result = runSetupWrite(codexHome, fakeCodex);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 1, output);
  assert.match(result.stderr, /excessive response/i);
  assert.doesNotMatch(output, /OVER_LIMIT_PAYLOAD_/);
  assertFilesUnchanged(before);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.marketplaceAddCount, 0);
  assert.equal(state.installCount, 0);
  assert.equal(state.removeCount, 0);
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
    'repo/scripts/toolkit-route-resolution.cjs',
    'repo/scripts/toolkit-host-route-adapters.cjs',
    'repo/scripts/claude-process-launch.cjs',
    'repo/scripts/repo-ignore-hygiene.cjs',
    'repo/scripts/repo-local-backup.cjs',
    'repo/scripts/audit-n8n-skills-plugin-hooks.cjs',
    'repo/scripts/repair-codex-plugin-windows-hooks.cjs'
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
  fs.appendFileSync(path.join(staleRoot, 'repo', 'scripts', 'toolkit-route-resolution.cjs'), '\n// stale route resolver\n');
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
