'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const script = path.join(repoRoot, 'scripts', 'package-packs.cjs');

function tempCopy() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-packs-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      return !rel.startsWith('.git') && !rel.startsWith('_dist') && !rel.startsWith('node_modules');
    }
  });
  return target;
}

test('every pack has valid pack manifest and existing install paths', () => {
  const packsRoot = path.join(repoRoot, 'packs');
  const packFiles = fs.readdirSync(packsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packsRoot, entry.name, 'pack.json'))
    .filter((file) => fs.existsSync(file));
  assert.equal(packFiles.length, 5);
  for (const file of packFiles) {
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(pack.requires_approval, true);
    assert.equal(pack.run_commands, false);
    for (const installPath of pack.installs) {
      assert.ok(fs.existsSync(path.join(repoRoot, installPath)), `${file} -> ${installPath}`);
    }
  }
});

test('package-packs --check validates inputs and does not write outputs', () => {
  const cwd = tempCopy();
  const result = spawnSync(process.execPath, [script, '--check'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(cwd, '_dist')), false);
  assert.match(result.stdout, /Pack package check passed/);
});
