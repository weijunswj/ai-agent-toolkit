'use strict';

// The one Toolkit version source. Every runtime version constant reads
// repo/contracts/toolkit-local-bridge/version.json through this module, and installed plugin
// copies carry the same file, so a copy always reports the version it was installed from.
// Change the version with repo/scripts/bump-version.cjs, never by hand.

const fs = require('node:fs');
const path = require('node:path');

const VERSION_REL_PATH = 'repo/contracts/toolkit-local-bridge/version.json';
const VERSION_FILE = path.join(__dirname, '..', 'contracts', 'toolkit-local-bridge', 'version.json');
const SEMVER = /^\d+\.\d+\.\d+$/;

function readToolkitVersion(file = VERSION_FILE) {
  const version = JSON.parse(fs.readFileSync(file, 'utf8')).version;
  if (!SEMVER.test(version || '')) throw new Error(`${file} must contain a semver version`);
  return version;
}

// The one version order: -1, 0 or 1 for two MAJOR.MINOR.PATCH versions, each part compared as a
// whole number of any size. Anything else throws, so no caller orders a version it cannot read.
function compareVersions(left, right) {
  for (const value of [left, right]) if (!SEMVER.test(String(value ?? ''))) throw new Error(`Not a MAJOR.MINOR.PATCH version: ${value}`);
  const a = String(left).split('.').map(BigInt), b = String(right).split('.').map(BigInt);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}

const TOOLKIT_VERSION = readToolkitVersion();

module.exports = { SEMVER, TOOLKIT_VERSION, VERSION_FILE, VERSION_REL_PATH, compareVersions, readToolkitVersion };
