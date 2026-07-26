'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CANONICAL_LOADER_SOURCE = [
  'function canonicalInventoryPath() {',
  '  return AUTHORITY_RUNTIME.join(',
  '    trustedRuntimeHome(),',
  "    '.ai-agent-toolkit',",
  "    'external-system',",
  "    'provider-target-registry.json'",
  '  );',
  '}'
].join('\n');
const BOOTSTRAP_MODE_SOURCE = [
  'const AUTHORITY_BOOTSTRAP_MODE = require.main === module',
  '  && process.argv.length === 3',
  '  && process.argv[2] === AUTHORITY_BOOTSTRAP_COMMAND;'
].join('\n');
const RUNTIME_EXECUTABLE_SOURCE = [
  'function runtimeExecutableIdentity() {',
  '  const executable = readTrustedRegularFile(',
  '    AUTHORITY_RUNTIME.execPath,',
  "    'EXTERNAL_INVENTORY_BOOTSTRAP_UNAVAILABLE',",
  '    MAX_RUNTIME_EXECUTABLE_BYTES',
  '  );',
  '  return {',
  '    runtimeExecutableVersion: AUTHORITY_RUNTIME.version,',
  '    runtimeExecutableDigest: executable.bytesDigest',
  '  };',
  '}'
].join('\n');

function createExternalSystemRouterTestHarness(
  routerSourcePath,
  prefix = 'external-router-harness-',
  { isolatedProcess = false } = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sourcePath = path.join(root, 'provider-target-registry.json');
  const modulePath = path.join(root, 'external-system-router.test-only.cjs');
  const productionSource = fs.readFileSync(routerSourcePath, 'utf8');
  const matches = productionSource.split(CANONICAL_LOADER_SOURCE).length - 1;
  if (matches !== 1) {
    throw new Error('Test harness requires one exact production canonical inventory loader.');
  }
  const bootstrapMatches = productionSource.split(BOOTSTRAP_MODE_SOURCE).length - 1;
  const executableMatches = productionSource.split(RUNTIME_EXECUTABLE_SOURCE).length - 1;
  const bootstrapGuard = /function assertTrustedAuthorityBootstrap\(\) \{[\s\S]*?\n\}\n\nfunction trustedRuntimeHome\(\)/;
  if (bootstrapMatches !== 1 || executableMatches !== 1 || !bootstrapGuard.test(productionSource)) {
    throw new Error('Test harness requires one exact production authority bootstrap boundary.');
  }
  let isolatedSource = productionSource.replace(CANONICAL_LOADER_SOURCE, [
    'function canonicalInventoryPath() {',
    `  return ${JSON.stringify(sourcePath)};`,
    '}'
  ].join('\n'));
  if (!isolatedProcess) {
    isolatedSource = isolatedSource
      .replace(BOOTSTRAP_MODE_SOURCE, 'const AUTHORITY_BOOTSTRAP_MODE = true;')
      .replace(bootstrapGuard, [
        'function assertTrustedAuthorityBootstrap() {}',
        '',
        'function trustedRuntimeHome()'
      ].join('\n'))
      .replace(RUNTIME_EXECUTABLE_SOURCE, [
        'function runtimeExecutableIdentity() {',
        '  return {',
        '    runtimeExecutableVersion: process.version,',
        "    runtimeExecutableDigest: sha256({ testRuntimeExecutableVersion: process.version })",
        '  };',
        '}'
      ].join('\n'));
  }
  fs.writeFileSync(modulePath, isolatedSource, 'utf8');
  fs.writeFileSync(sourcePath, '{}\n', 'utf8');
  const router = require(modulePath);
  const repositoryRealPath = fs.realpathSync.native(process.cwd());
  const installationRealPath = fs.realpathSync.native(path.dirname(modulePath));
  const routerSourceDigest = router.sha256(fs.readFileSync(modulePath));
  const runtimeExecutableDigest = isolatedProcess
    ? router.sha256(fs.readFileSync(process.execPath))
    : router.sha256({ testRuntimeExecutableVersion: process.version });
  const identity = Object.freeze({
    routerVersion: router.ROUTER_VERSION,
    routerSourceDigest,
    authorityBootstrapVersion: 'ai-agent-toolkit.external-authority-bootstrap.v1',
    bootstrapSourceDigest: routerSourceDigest,
    runtimeExecutableVersion: process.version,
    runtimeExecutableDigest,
    repositoryIdentity: router.sha256({ repositoryRealPath }),
    hostIdentity: router.sha256({ platform: process.platform, hostname: os.hostname() }),
    installationIdentity: router.sha256({ installationRealPath }),
    authorityPathDigest: router.sha256({ authorityRealPath: fs.realpathSync.native(sourcePath) })
  });
  return Object.freeze({ root, sourcePath, modulePath, router, identity });
}

module.exports = { createExternalSystemRouterTestHarness };
