#!/usr/bin/env node
'use strict';

// Sets the Toolkit version in one step: writes version.json (the one version source) and the four
// plugin manifests hosts read, then refreshes the generated surfaces that carry the version
// (managed-block markers, the README contract block and the published-surface baseline).
// Usage: node repo/scripts/bump-version.cjs <x.y.z> [--workspace <repo root>]

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SEMVER, VERSION_REL_PATH, readToolkitVersion } = require('./toolkit-version.cjs');

// Hosts read these literal versions, so they stay literal and the validator checks them against version.json.
const MANIFEST_REL_PATHS = Object.freeze([
  'repo/contracts/toolkit-local-bridge/codex-plugin/plugin.json',
  'repo/contracts/toolkit-local-bridge/claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.claude-plugin/plugin.json',
]);
const REFRESH_COMMANDS = Object.freeze([
  ['repo/scripts/sync-agent-instruction-shims.cjs', '--write'],
  ['repo/scripts/sync-repo-doc-contract.cjs', '--write'],
  ['repo/scripts/audit-published-surfaces.cjs', '--write-baseline'],
]);

function parseArgs(argv) {
  const args = { version: '', workspace: path.resolve(__dirname, '..', '..') };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') args.workspace = path.resolve(argv[++index] || '');
    else if (arg.startsWith('--workspace=')) args.workspace = path.resolve(arg.slice('--workspace='.length));
    else if (!args.version && !arg.startsWith('-')) args.version = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!SEMVER.test(args.version)) throw new Error('usage: node repo/scripts/bump-version.cjs <x.y.z> [--workspace <repo root>]');
  return args;
}

function setJsonVersion(file, version) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof value.version !== 'string') throw new Error(`${file} has no version field`);
  value.version = version;
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function bumpVersion(version, workspace) {
  const files = [VERSION_REL_PATH, ...MANIFEST_REL_PATHS];
  for (const rel of files) setJsonVersion(path.join(workspace, ...rel.split('/')), version);
  for (const [script, ...args] of REFRESH_COMMANDS) {
    const result = spawnSync(process.execPath, [path.join(workspace, ...script.split('/')), ...args, '--workspace', workspace], {
      cwd: workspace, encoding: 'utf8', windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(`${script} ${args.join(' ')} failed (exit ${result.status}):\n${result.stderr || result.stdout}`);
    }
  }
  const written = readToolkitVersion(path.join(workspace, ...VERSION_REL_PATH.split('/')));
  if (written !== version) throw new Error(`${VERSION_REL_PATH} reads ${written} after the bump, expected ${version}`);
  return { version, files, refreshed: REFRESH_COMMANDS.map(([script]) => script) };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = bumpVersion(args.version, args.workspace);
    console.log(`Toolkit version is now ${result.version}. Wrote ${result.files.join(', ')}; refreshed ${result.refreshed.join(', ')}.`);
    console.log('Add the CHANGELOG entry for this version yourself.');
  } catch (error) {
    console.error(`bump-version: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { MANIFEST_REL_PATHS, REFRESH_COMMANDS, bumpVersion, parseArgs };
