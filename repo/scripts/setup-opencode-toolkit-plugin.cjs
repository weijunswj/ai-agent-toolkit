#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_VERSION = '2.12.3';
const PLUGIN_REL = 'repo/contracts/toolkit-local-bridge/opencode-plugin';
const STATES = Object.freeze(['LEGACY_BRIDGE', 'PLUGIN_PACKAGE_READY', 'INSTALLED_VERIFIED', 'NATIVE_UAT_ACCEPTED', 'BRIDGE_REMOVAL_AUTHORISED']);

function repoRootFrom(options = {}) {
  return path.resolve(options.repoRoot || path.join(__dirname, '..', '..'));
}

function packageRoot(repoRoot) {
  return path.join(repoRoot, PLUGIN_REL.replace(/\//g, path.sep));
}

function validateRepoOpenCodePlugin(repoRoot = repoRootFrom()) {
  const root = packageRoot(repoRoot);
  const packagePath = path.join(root, 'package.json');
  const indexPath = path.join(root, 'index.js');
  const errors = [];
  let packageJson = null;
  try { packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')); } catch (error) { errors.push(`package.json: ${error.message}`); }
  if (!fs.existsSync(indexPath)) errors.push('index.js is missing');
  if (packageJson?.version !== PACKAGE_VERSION) errors.push('OpenCode plugin package version is not 2.12.3');
  if (packageJson?.main !== 'index.js') errors.push('OpenCode plugin package main is not index.js');
  return Object.freeze({ ok: errors.length === 0, package_version: packageJson?.version || null, errors, package_path: packagePath, index_path: indexPath });
}

function migrationState(input = {}) {
  const validated = validateRepoOpenCodePlugin(input.repoRoot);
  const installed = input.installed_verified === true;
  const uat = input.native_uat_accepted === true;
  const webAccepted = input.web_accepted === true;
  let state = validated.ok ? 'PLUGIN_PACKAGE_READY' : 'LEGACY_BRIDGE';
  if (installed && validated.ok) state = 'INSTALLED_VERIFIED';
  if (uat && installed && validated.ok) state = 'NATIVE_UAT_ACCEPTED';
  if (webAccepted && uat && installed && validated.ok) state = 'BRIDGE_REMOVAL_AUTHORISED';
  return Object.freeze({
    contract_version: 'toolkit.local-bridge.opencode-plugin-migration.v1',
    state,
    package_version: PACKAGE_VERSION,
    bridge_removal_allowed: state === 'BRIDGE_REMOVAL_AUTHORISED',
    live_install_attempted: false,
    native_uat_accepted: uat
  });
}

function installOpenCodePlugin(options = {}) {
  if (options.live_install_authorized !== true || options.native_uat_accepted === true) {
    throw new Error('OPENCODE_INSTALL_REQUIRES_SEPARATE_WEB_AUTHORITY');
  }
  const validation = validateRepoOpenCodePlugin(options.repoRoot);
  if (!validation.ok) throw new Error('OPENCODE_PLUGIN_PACKAGE_INVALID');
  if (typeof options.targetRoot !== 'string' || !options.targetRoot || typeof options.writeFile !== 'function') throw new Error('OPENCODE_INSTALL_TARGET_REQUIRED');
  const targetRoot = path.resolve(options.targetRoot);
  const sourceRoot = packageRoot(repoRootFrom(options));
  const files = ['package.json', 'index.js'];
  for (const file of files) options.writeFile(path.join(targetRoot, file), fs.readFileSync(path.join(sourceRoot, file)));
  return migrationState({ ...options, installed_verified: true });
}

function main(args = process.argv.slice(2)) {
  const json = args.includes('--json');
  const result = migrationState({ repoRoot: repoRootFrom() });
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`OpenCode native plugin state: ${result.state}; local bridge removal allowed: ${result.bridge_removal_allowed ? 'yes' : 'no'}.`);
  return result.state === 'LEGACY_BRIDGE' ? 1 : 0;
}

if (require.main === module) {
  try { process.exitCode = main(); } catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}

module.exports = Object.freeze({
  PACKAGE_VERSION,
  PLUGIN_REL,
  STATES,
  validateRepoOpenCodePlugin,
  migrationState,
  installOpenCodePlugin,
  main
});
