'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const cache = require('../scripts/setup-codex-toolkit-plugin.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const identity = cache.pluginId();

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cache-recovery-'));
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
    return;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function writeMatchingCache(codexHome, version = cache.EXPECTED_TOOLKIT_VERSION) {
  const root = cache.cacheRootFor(codexHome, version);
  for (const relPath of cache.CACHE_FINGERPRINT_PATHS) {
    copyPath(path.join(repoRoot, ...relPath.split('/')), path.join(root, ...relPath.split('/')));
  }
  for (const relDir of cache.CACHE_FINGERPRINT_DIRS) {
    copyPath(path.join(repoRoot, ...relDir.split('/')), path.join(root, ...relDir.split('/')));
  }
  if (process.platform === 'win32') cache.prepareInstalledSessionStart(root);
  if (version !== cache.EXPECTED_TOOLKIT_VERSION) {
    const manifestPath = path.join(root, '.codex-plugin', 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.version = version;
    writeJson(manifestPath, manifest);
  }
  return root;
}

function writeCodexConfig(codexHome, enabled = true, extra = '') {
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), [
    `[plugins."${identity}"]`,
    `enabled = ${enabled ? 'true' : 'false'}`,
    '',
    '[marketplaces.ai-agent-toolkit-local]',
    `path = ${JSON.stringify(repoRoot)}`,
    extra,
    ''
  ].join('\n'), 'utf8');
}

function installedEntry(options = {}) {
  const version = options.version || cache.EXPECTED_TOOLKIT_VERSION;
  const entry = {
    pluginId: identity,
    name: 'ai-agent-toolkit',
    marketplaceName: 'ai-agent-toolkit-local',
    version,
    installed: options.installed !== false,
    enabled: options.enabled !== false,
    authPolicy: 'ON_USE',
    source: { source: 'local', path: repoRoot }
  };
  if (Object.prototype.hasOwnProperty.call(options, 'activeVersion')) entry.activeVersion = options.activeVersion;
  return entry;
}

function sourceProof() {
  return {
    trusted: true,
    ambiguous: false,
    plugin_id: identity,
    source_root: repoRoot,
    version: cache.EXPECTED_TOOLKIT_VERSION,
    fingerprint: 'a'.repeat(64),
    fingerprint_verified: true,
    evidence_source: 'trusted-repo-validation'
  };
}

function configurationProof(enabled = true) {
  return {
    trusted: true,
    ambiguous: false,
    plugin_id: identity,
    plugin_name: 'ai-agent-toolkit',
    marketplace_name: 'ai-agent-toolkit-local',
    enabled,
    user_disabled: !enabled,
    status: enabled ? 'enabled' : 'disabled',
    evidence_source: 'codex-config-inspection'
  };
}

function installedProof(cacheRoot, version = cache.EXPECTED_TOOLKIT_VERSION, fingerprint = 'a'.repeat(64)) {
  return {
    trusted: true,
    ambiguous: false,
    plugin_id: identity,
    plugin_name: 'ai-agent-toolkit',
    marketplace_name: 'ai-agent-toolkit-local',
    installed: true,
    enabled: true,
    active: true,
    reported_version: version,
    active_version: version,
    version,
    current: version === cache.EXPECTED_TOOLKIT_VERSION,
    cache_root: path.resolve(cacheRoot),
    cache_manifest_version: version,
    bytes_verified: true,
    source_root: repoRoot,
    source_fingerprint: fingerprint,
    cache_fingerprint: fingerprint,
    fingerprint,
    fingerprint_verified: true,
    evidence_source: 'codex-plugin-list+cache'
  };
}

function cacheObject(cacheRoot, version = cache.EXPECTED_TOOLKIT_VERSION, proof = installedProof(cacheRoot, version)) {
  return {
    present: true,
    version,
    bytes_verified: true,
    trusted: true,
    cache_root: path.resolve(cacheRoot),
    fingerprint: proof.fingerprint,
    fingerprint_verified: true,
    status: 'fresh',
    installed_state_proof: proof
  };
}

function recoveryOptions(cacheRoot, overrides = {}) {
  return {
    source_proof: sourceProof(),
    configuration_proof: configurationProof(),
    cache: cacheObject(cacheRoot),
    ...overrides
  };
}

test('explicit enabled current Toolkit config produces trusted configuration proof', () => {
  const codexHome = tmpRoot();
  writeCodexConfig(codexHome, true);
  const proof = cache.inspectCodexToolkitConfigurationProof({ codexHome });
  assert.equal(proof.trusted, true);
  assert.equal(proof.enabled, true);
  assert.equal(proof.user_disabled, false);
  assert.equal(proof.plugin_id, identity);
  assert.equal(proof.evidence_source, 'codex-config-inspection');
});

test('explicit disabled config is preserved and refresh is not attempted', () => {
  const codexHome = tmpRoot();
  writeCodexConfig(codexHome, false);
  const proof = cache.inspectCodexToolkitConfigurationProof({ codexHome });
  assert.equal(proof.trusted, true);
  assert.equal(proof.enabled, false);
  assert.equal(proof.user_disabled, true);

  let refreshCalls = 0;
  const result = cache.recoverCodexCache({
    ...recoveryOptions(path.join(codexHome, 'cache'), {
      configuration_proof: proof,
      refresh_required: true,
      refreshSupported: () => { refreshCalls += 1; return true; },
      rediscover: () => { throw new Error('must not rediscover disabled state'); }
    })
  });
  assert.equal(result.reason_code, 'CONFIGURATION_FAILURE');
  assert.equal(result.healthy, false);
  assert.equal(refreshCalls, 0);
});

test('missing config state fails closed', () => {
  const proof = cache.inspectCodexToolkitConfigurationProof({ codexHome: tmpRoot() });
  assert.equal(proof.trusted, false);
  assert.equal(proof.ambiguous, true);
  assert.equal(proof.enabled, null);
});

test('duplicate or ambiguous config state fails closed', () => {
  const codexHome = tmpRoot();
  writeCodexConfig(codexHome, true, `[plugins.'${identity}']\nenabled = true`);
  const proof = cache.inspectCodexToolkitConfigurationProof({ codexHome });
  assert.equal(proof.trusted, false);
  assert.equal(proof.ambiguous, true);
  assert.match(proof.reason, /multiple/i);
});

test('installed-state proof cannot be healthy from a caller or synthetic boolean alone', () => {
  const codexHome = tmpRoot();
  const rejected = cache.inspectCodexToolkitInstalledState({
    codexHome,
    repoRoot,
    pluginList: { installed: [installedEntry()] }
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.proof.trusted, false);

  const cacheRoot = path.join(codexHome, 'cache');
  const result = cache.recoverCodexCache(recoveryOptions(cacheRoot, {
    cache: {
      ...cacheObject(cacheRoot),
      installed_state_proof: { trusted: true, active: true }
    }
  }));
  assert.equal(result.reason_code, 'CACHE_VERSION_OR_BYTES_UNVERIFIED');
  assert.equal(result.healthy, false);
});

test('missing installed Toolkit plugin fails', () => {
  const result = cache.deriveCodexInstalledStateProof({ installed: [], available: [] }, {
    codexHome: tmpRoot(),
    repoRoot
  });
  assert.equal(result.ok, false);
  assert.equal(result.proof.trusted, false);
  assert.match(result.errors.join('\n'), /not installed/i);
});

test('disabled installed Toolkit plugin fails and preserves disabled evidence', () => {
  const codexHome = tmpRoot();
  writeMatchingCache(codexHome);
  const result = cache.deriveCodexInstalledStateProof({ installed: [installedEntry({ enabled: false })] }, {
    codexHome,
    repoRoot
  });
  assert.equal(result.ok, false);
  assert.equal(result.proof.trusted, false);
  assert.equal(result.proof.enabled, false);
  assert.match(result.errors.join('\n'), /not enabled/i);
});

test('ambiguous installed Toolkit entries fail', () => {
  const codexHome = tmpRoot();
  writeMatchingCache(codexHome);
  const result = cache.deriveCodexInstalledStateProof({
    installed: [installedEntry(), installedEntry()],
    available: []
  }, { codexHome, repoRoot });
  assert.equal(result.ok, false);
  assert.equal(result.proof.trusted, false);
  assert.equal(result.proof.ambiguous, true);
  assert.match(result.errors.join('\n'), /ambiguous/i);
});

test('version mismatch cannot establish current healthy state', () => {
  const codexHome = tmpRoot();
  const version = '2.11.1';
  writeMatchingCache(codexHome, version);
  const result = cache.deriveCodexInstalledStateProof({ installed: [installedEntry({ version })] }, {
    codexHome,
    repoRoot
  });
  assert.equal(result.ok, false);
  assert.equal(result.proof.current, false);
  assert.match(result.errors.join('\n'), /expected version/i);
});

test('fresh observed current install plus matching cache produces valid installed-state proof', () => {
  const codexHome = tmpRoot();
  const observedRoot = writeMatchingCache(codexHome, cache.EXPECTED_TOOLKIT_VERSION);
  const result = cache.deriveCodexInstalledStateProof({
    installed: [installedEntry()],
    available: []
  }, { codexHome, repoRoot });
  assert.equal(result.ok, true);
  assert.equal(result.proof.trusted, true);
  assert.equal(result.proof.plugin_id, identity);
  assert.equal(result.proof.installed, true);
  assert.equal(result.proof.enabled, true);
  assert.equal(result.proof.reported_version, cache.EXPECTED_TOOLKIT_VERSION);
  assert.equal(path.resolve(result.proof.cache_root), path.resolve(observedRoot));
  assert.equal(result.proof.cache_manifest_version, cache.EXPECTED_TOOLKIT_VERSION);
  assert.equal(result.proof.bytes_verified, true);
  assert.equal(result.proof.fingerprint_verified, true);
});

test('current cache recovery is a quiet no-op only with complete proof bindings', () => {
  const cacheRoot = path.join(tmpRoot(), 'cache');
  const result = cache.recoverCodexCache(recoveryOptions(cacheRoot));
  assert.equal(result.state, 'NOOP');
  assert.equal(result.healthy, true);
  assert.equal(result.manual_action, false);
  assert.equal(result.installed_state_proof.trusted, true);
});

test('manual setup is surfaced only for an unsupported recovery path', () => {
  const result = cache.recoverCodexCache({
    source_proof: sourceProof(),
    configuration_proof: configurationProof(),
    refresh_required: true
  });
  assert.equal(result.reason_code, 'UNSUPPORTED_TOOL');
  assert.equal(result.manual_action, true);
});

test('stale executing cache is not healthy', () => {
  const cacheRoot = path.join(tmpRoot(), 'cache');
  const result = cache.recoverCodexCache(recoveryOptions(cacheRoot, {
    cache: { ...cacheObject(cacheRoot), executing: true }
  }));
  assert.equal(result.state, 'TERMINAL');
  assert.equal(result.healthy, false);
  assert.equal(result.manual_action, false);
});

test('refresh health is bound to a freshly rediscovered cache and fingerprint', () => {
  const cacheRoot = path.join(tmpRoot(), 'cache');
  let rediscoveries = 0;
  const fresh = cacheObject(cacheRoot);
  const result = cache.recoverCodexCache(recoveryOptions(cacheRoot, {
    refresh_required: true,
    refreshSupported: () => true,
    rediscover: () => { rediscoveries += 1; return fresh; }
  }));
  assert.equal(result.healthy, true);
  assert.equal(result.reason_code, 'CACHE_REFRESHED');
  assert.equal(rediscoveries, 1);
  assert.equal(result.cache_fingerprint, 'a'.repeat(64));
});

test('bounded transient retry and one repair remain enforced', () => {
  const cacheRoot = path.join(tmpRoot(), 'cache');
  let rediscoveries = 0;
  let retries = 0;
  const result = cache.recoverCodexCache(recoveryOptions(cacheRoot, {
    cache: { transient: true, present: false },
    rediscover: () => {
      rediscoveries += 1;
      return rediscoveries === 1 ? { transient: true, present: false } : cacheObject(cacheRoot);
    },
    retryTransient: () => { retries += 1; return true; }
  }));
  assert.equal(result.healthy, true);
  assert.equal(result.attempts, 1);
  assert.equal(retries, 1);
  assert.equal(rediscoveries, 2);

  let repairCalls = 0;
  let repairRediscoveries = 0;
  const repaired = cache.recoverCodexCache(recoveryOptions(cacheRoot, {
    cache: { repairable: true, present: false },
    rediscover: () => {
      repairRediscoveries += 1;
      return repairRediscoveries === 1 ? { repairable: true, present: false } : cacheObject(cacheRoot);
    },
    repairSupported: () => { repairCalls += 1; return true; }
  }));
  assert.equal(repaired.healthy, true);
  assert.equal(repaired.reason_code, 'CACHE_REPAIRED');
  assert.equal(repairCalls, 1);
  assert.equal(repairRediscoveries, 2);
});

test('newer installed cache is protected from downgrade or generic reset', () => {
  const cacheRoot = path.join(tmpRoot(), 'cache');
  const newerVersion = '2.14.0';
  const result = cache.recoverCodexCache(recoveryOptions(cacheRoot, {
    cache: {
      ...cacheObject(cacheRoot, newerVersion, installedProof(cacheRoot, newerVersion)),
      version: newerVersion,
      bytes_verified: false
    },
    repairSupported: () => { throw new Error('must not repair'); }
  }));
  assert.equal(result.reason_code, 'DOWNGRADE_PROTECTION');
  assert.equal(result.manual_action, true);
  assert.equal(result.healthy, false);
  assert.doesNotMatch(cache.recoverCodexCache.toString(), /rmSync|reset/i);
});

test('legacy source_verified alone and unbound trusted booleans cannot pass', () => {
  const result = cache.recoverCodexCache({
    source_verified: true,
    cache: { present: true, version: cache.EXPECTED_TOOLKIT_VERSION, bytes_verified: true, trusted: true }
  });
  assert.equal(result.reason_code, 'TRUST_FAILURE');
  assert.equal(result.healthy, false);
});
