'use strict';

// The one version source: every runtime constant reads version.json, and bump-version.cjs changes
// the version everywhere it appears and nowhere else.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { TOOLKIT_VERSION, VERSION_REL_PATH, readToolkitVersion } = require('../scripts/toolkit-version.cjs');
const { MANIFEST_REL_PATHS } = require('../scripts/bump-version.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');

test('every runtime version constant equals version.json', () => {
  const recorded = JSON.parse(fs.readFileSync(path.join(repoRoot, ...VERSION_REL_PATH.split('/')), 'utf8')).version;
  assert.equal(TOOLKIT_VERSION, recorded);
  assert.equal(require('../scripts/toolkit-local-bridge.cjs').BRIDGE_VERSION, recorded);
  assert.equal(require('../scripts/setup-codex-toolkit-plugin.cjs').EXPECTED_TOOLKIT_VERSION, recorded);
  assert.equal(require('../scripts/toolkit-agent-control.cjs').CONTROL_VERSION, recorded);
  const delegation = fs.readFileSync(path.join(repoRoot, 'repo', 'scripts', 'codex-delegation-config.cjs'), 'utf8');
  assert.match(delegation, /^const TOOLKIT_CLIENT_VERSION = TOOLKIT_VERSION;$/m);
  for (const rel of MANIFEST_REL_PATHS) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(repoRoot, ...rel.split('/')), 'utf8')).version, recorded, rel);
  }
});

test('the version source refuses a version.json without a semver version', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-version-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'version.json');
  fs.writeFileSync(file, JSON.stringify({ version: '3.x' }));
  assert.throws(() => readToolkitVersion(file), /must contain a semver version/);
  fs.writeFileSync(file, JSON.stringify({ version: '3.10.0' }));
  assert.equal(readToolkitVersion(file), '3.10.0');
});

function trackedFiles() {
  const result = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\0').filter((rel) => rel && fs.existsSync(path.join(repoRoot, rel)));
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('bump-version changes the version everywhere it appears and nothing else', (t) => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-bump-'));
  t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  const files = trackedFiles();
  const before = new Map();
  for (const rel of files) {
    const target = path.join(copy, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, rel), target);
    before.set(rel, digest(target));
  }

  const result = spawnSync(process.execPath, [path.join(copy, 'repo', 'scripts', 'bump-version.cjs'), '9.9.9'], { cwd: copy, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Toolkit version is now 9\.9\.9\./);

  const changed = files.filter((rel) => digest(path.join(copy, rel)) !== before.get(rel));
  for (const rel of [VERSION_REL_PATH, ...MANIFEST_REL_PATHS, 'repo/docs/published-surface-audit-baseline.json', 'AGENTS.md', 'README.md']) {
    assert.ok(changed.includes(rel), `${rel} should carry the new version`);
  }
  // Every changed file differs from the original only by the version number.
  for (const rel of changed) {
    const text = fs.readFileSync(path.join(copy, rel), 'utf8');
    assert.equal(text.split('9.9.9').join(TOOLKIT_VERSION), fs.readFileSync(path.join(repoRoot, rel), 'utf8'), `${rel} changed beyond the version`);
  }

  const runtime = spawnSync(process.execPath, ['-e', [
    "const v = require('./repo/scripts/toolkit-version.cjs').TOOLKIT_VERSION;",
    "const b = require('./repo/scripts/toolkit-local-bridge.cjs').BRIDGE_VERSION;",
    "const c = require('./repo/scripts/toolkit-agent-control.cjs').CONTROL_VERSION;",
    "const s = require('./repo/scripts/setup-codex-toolkit-plugin.cjs').EXPECTED_TOOLKIT_VERSION;",
    'process.stdout.write([v, b, c, s].join(" "));',
  ].join('\n')], { cwd: copy, encoding: 'utf8' });
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.equal(runtime.stdout, '9.9.9 9.9.9 9.9.9 9.9.9');

  const validation = spawnSync(process.execPath, [path.join(copy, 'repo', 'scripts', 'validate-toolkit.cjs')], { cwd: copy, encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
});

test('bump-version refuses a non-semver version without writing', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'bump-version.cjs'), 'next'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage: node repo\/scripts\/bump-version\.cjs <x\.y\.z>/);
  assert.equal(readToolkitVersion(), TOOLKIT_VERSION);
});
