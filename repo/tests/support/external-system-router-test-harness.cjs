'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CANONICAL_LOADER_SOURCE = [
  'function canonicalInventoryPath() {',
  "  return path.join(trustedRuntimeHome(), '.ai-agent-toolkit', 'external-system', 'provider-target-registry.json');",
  '}'
].join('\n');

function createExternalSystemRouterTestHarness(routerSourcePath, prefix = 'external-router-harness-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sourcePath = path.join(root, 'provider-target-registry.json');
  const modulePath = path.join(root, 'external-system-router.test-only.cjs');
  const productionSource = fs.readFileSync(routerSourcePath, 'utf8');
  const matches = productionSource.split(CANONICAL_LOADER_SOURCE).length - 1;
  if (matches !== 1) {
    throw new Error('Test harness requires one exact production canonical inventory loader.');
  }
  const isolatedSource = productionSource.replace(CANONICAL_LOADER_SOURCE, [
    'function canonicalInventoryPath() {',
    `  return ${JSON.stringify(sourcePath)};`,
    '}'
  ].join('\n'));
  fs.writeFileSync(modulePath, isolatedSource, 'utf8');
  fs.writeFileSync(sourcePath, '{}\n', 'utf8');
  const router = require(modulePath);
  const repositoryRealPath = fs.realpathSync.native(process.cwd());
  const installationRealPath = fs.realpathSync.native(path.dirname(modulePath));
  const identity = Object.freeze({
    routerVersion: router.ROUTER_VERSION,
    routerSourceDigest: router.sha256(fs.readFileSync(modulePath)),
    repositoryIdentity: router.sha256({ repositoryRealPath }),
    hostIdentity: router.sha256({ platform: process.platform, hostname: os.hostname() }),
    installationIdentity: router.sha256({ installationRealPath }),
    authorityPathDigest: router.sha256({ authorityRealPath: fs.realpathSync.native(sourcePath) })
  });
  return Object.freeze({ root, sourcePath, modulePath, router, identity });
}

module.exports = { createExternalSystemRouterTestHarness };
