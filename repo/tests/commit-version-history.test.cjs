'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const { auditRange } = require('../scripts/audit-commit-version-history.cjs');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function writeFile(root, relativePath, content) {
  const absolute = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
}

function writeJson(root, relativePath, value) {
  writeFile(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function createRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-version-history-'));
  git(root, ['init']);
  git(root, ['branch', '-M', 'main']);
  git(root, ['config', 'user.email', 'c32-test@example.invalid']);
  git(root, ['config', 'user.name', 'C32 Test']);
  return root;
}

function createGenericModule(root, id = 'test.module', modulePath = '_projects/test/module', outputPath = 'skills/test/SKILL.md') {
  writeJson(root, `${modulePath}/toolkit.project.json`, {
    id,
    category: 'test',
    name: id.split('.').at(-1),
    title: 'Synthetic test module',
    module_path: modulePath,
    main_path: `${modulePath}/_main`,
    version: '1.0.0',
    version_policy: 'semver',
    version_notes: 'Synthetic fixture.',
    outputs: [{ kind: 'copy', source: '_main/SKILL.md', output: outputPath }]
  });
  writeFile(root, `${modulePath}/_main/SKILL.md`, 'baseline\n');
  writeFile(root, outputPath, 'baseline\n');
}

function createBridgeModule(root) {
  writeJson(root, '_projects/development/toolkit-local-bridge/toolkit.project.json', {
    id: 'development.toolkit-local-bridge',
    category: 'development',
    name: 'toolkit-local-bridge',
    title: 'Synthetic bridge',
    module_path: '_projects/development/toolkit-local-bridge',
    main_path: '_projects/development/toolkit-local-bridge/_main',
    version: '1.0.0',
    version_policy: 'semver',
    version_notes: 'Synthetic fixture.',
    outputs: [{ kind: 'curated', source: 'curated_output_for_ai/skills/toolkit-setup/SKILL.md', output: 'skills/toolkit-setup/SKILL.md' }]
  });
  writeFile(root, '_projects/development/toolkit-local-bridge/_main/codex-plugin/plugin.json', '{"version":"1.0.0"}\n');
  writeFile(root, '_projects/development/toolkit-local-bridge/_main/claude-plugin/plugin.json', '{"version":"1.0.0"}\n');
  writeFile(root, '.codex-plugin/plugin.json', '{"version":"1.0.0"}\n');
  writeFile(root, '.claude-plugin/plugin.json', '{"version":"1.0.0"}\n');
  writeFile(root, 'repo/scripts/toolkit-local-bridge.cjs', "const BRIDGE_VERSION = '1.0.0';\n");
  writeFile(root, 'repo/scripts/setup-codex-toolkit-plugin.cjs', "const EXPECTED_TOOLKIT_VERSION = '1.0.0';\n");
  writeFile(root, 'repo/scripts/codex-delegation-config.cjs', "const TOOLKIT_CLIENT_VERSION = '1.0.0';\n");
  writeFile(root, 'repo/scripts/toolkit-agent-control.cjs', "const CONTROL_VERSION = '1.0.0';\n");
  writeFile(root, 'skills/toolkit-setup/SKILL.md', 'baseline\n');
}

function updateGeneric(root, version = null, suffix = 'changed') {
  writeFile(root, '_projects/test/module/_main/SKILL.md', `${suffix}\n`);
  writeFile(root, 'skills/test/SKILL.md', `${suffix}\n`);
  if (version) {
    const manifestPath = path.join(root, '_projects/test/module/toolkit.project.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.version = version;
    writeJson(root, '_projects/test/module/toolkit.project.json', manifest);
  }
}

function updateBridge(root, version, omitPath = null) {
  const files = {
    '_projects/development/toolkit-local-bridge/toolkit.project.json': (text) => {
      const value = JSON.parse(text);
      value.version = version;
      return `${JSON.stringify(value, null, 2)}\n`;
    },
    '_projects/development/toolkit-local-bridge/_main/codex-plugin/plugin.json': (text) => text.replace('1.0.0', version),
    '_projects/development/toolkit-local-bridge/_main/claude-plugin/plugin.json': (text) => text.replace('1.0.0', version),
    '.codex-plugin/plugin.json': (text) => text.replace('1.0.0', version),
    '.claude-plugin/plugin.json': (text) => text.replace('1.0.0', version),
    'repo/scripts/toolkit-local-bridge.cjs': (text) => text.replace('1.0.0', version),
    'repo/scripts/setup-codex-toolkit-plugin.cjs': (text) => text.replace('1.0.0', version),
    'repo/scripts/codex-delegation-config.cjs': (text) => text.replace('1.0.0', version),
    'repo/scripts/toolkit-agent-control.cjs': (text) => text.replace('1.0.0', version)
  };
  for (const [relativePath, transform] of Object.entries(files)) {
    if (relativePath === omitPath) continue;
    const absolute = path.join(root, ...relativePath.split('/'));
    fs.writeFileSync(absolute, transform(fs.readFileSync(absolute, 'utf8')), 'utf8');
  }
  writeFile(root, 'repo/scripts/toolkit-local-bridge.cjs', `${fs.readFileSync(path.join(root, 'repo/scripts/toolkit-local-bridge.cjs'), 'utf8')}change\n`);
}

function baseAndHead(root) {
  const base = git(root, ['rev-parse', 'HEAD']);
  return { base, head: git(root, ['rev-parse', 'HEAD']) };
}

function assertPass(root, base) {
  const result = auditRange({ repoRoot: root, base, head: git(root, ['rev-parse', 'HEAD']) });
  assert.equal(result.firstViolation, null);
  return result;
}

function assertFailsAt(root, base, expectedCommit, expectedReason) {
  const result = auditRange({ repoRoot: root, base, head: git(root, ['rev-parse', 'HEAD']) });
  assert.equal(result.firstViolation.commit, expectedCommit);
  assert.match(result.firstViolation.reason, expectedReason);
  return result;
}

test('packaged skill changed without a module bump is rejected', (t) => {
  const root = createRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createGenericModule(root);
  const base = commit(root, 'base');
  updateGeneric(root, null, 'missing bump');
  const bad = commit(root, 'packaged change without bump');
  assertFailsAt(root, base, bad, /same-commit version transition missing/);
});

test('packaged skill changed with the correct same-commit bump is accepted', (t) => {
  const root = createRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createGenericModule(root);
  const base = commit(root, 'base');
  updateGeneric(root, '1.0.1', 'patched');
  commit(root, 'packaged change with bump');
  assertPass(root, base);
});

test('a later bump cannot cure an earlier missing bump', (t) => {
  const root = createRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createGenericModule(root);
  const base = commit(root, 'base');
  updateGeneric(root, null, 'first change');
  const first = commit(root, 'first change without bump');
  updateGeneric(root, '1.0.1', 'second change');
  commit(root, 'later catch-up bump');
  assertFailsAt(root, base, first, /same-commit version transition missing/);
});

test('non-packaged test-only changes do not require a bump', (t) => {
  const root = createRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createGenericModule(root);
  const base = commit(root, 'base');
  writeFile(root, 'repo/tests/example.test.cjs', 'test-only\n');
  commit(root, 'test-only change');
  assertPass(root, base);
});

test('invalid SemVer is rejected deterministically', (t) => {
  const root = createRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createGenericModule(root);
  const base = commit(root, 'base');
  updateGeneric(root, '1.0', 'invalid version');
  const bad = commit(root, 'invalid version');
  assertFailsAt(root, base, bad, /invalid SemVer/);
});

test('non-monotonic SemVer is rejected', (t) => {
  const root = createRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createGenericModule(root);
  const base = commit(root, 'base');
  updateGeneric(root, '0.9.0', 'decreasing version');
  const bad = commit(root, 'decreasing version');
  assertFailsAt(root, base, bad, /non-monotonic/);
});

test('every coupled bridge version surface is required in the triggering commit', (t) => {
  const root = createRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createBridgeModule(root);
  const base = commit(root, 'base');
  updateBridge(root, '1.0.1', 'repo/scripts/codex-delegation-config.cjs');
  const bad = commit(root, 'bridge bump omits one coupled surface');
  assertFailsAt(root, base, bad, /coupled version surface/);
});

test('multiple triggered families are all checked', (t) => {
  const root = createRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createGenericModule(root);
  createGenericModule(root, 'second.module', '_projects/test/second', 'skills/second/SKILL.md');
  const base = commit(root, 'base');
  updateGeneric(root, '1.0.1', 'first family changed');
  writeFile(root, '_projects/test/second/_main/SKILL.md', 'second family changed\n');
  writeFile(root, 'skills/second/SKILL.md', 'second family changed\n');
  const secondManifestPath = path.join(root, '_projects/test/second/toolkit.project.json');
  const secondManifest = JSON.parse(fs.readFileSync(secondManifestPath, 'utf8'));
  secondManifest.version = '1.0.0';
  writeJson(root, '_projects/test/second/toolkit.project.json', secondManifest);
  const bad = commit(root, 'two families with one bump');
  const result = assertFailsAt(root, base, bad, /same-commit version transition missing/);
  assert.equal(result.firstViolation.version_family, 'second.module');
  assert.ok(result.firstViolation.trigger.some((value) => value.includes('second')));
});

test('the earliest offending SHA is reported, not merely the terminal mismatch', (t) => {
  const root = createRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createGenericModule(root);
  const base = commit(root, 'base');
  updateGeneric(root, null, 'earliest bad');
  const earliest = commit(root, 'earliest bad');
  updateGeneric(root, null, 'later bad');
  commit(root, 'later bad');
  assertFailsAt(root, base, earliest, /same-commit version transition missing/);
});
